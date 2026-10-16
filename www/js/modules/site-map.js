/* global $ */

/* OpenSprinkler App
 * Copyright (C) 2015 - present, Samer Albahra. All rights reserved.
 *
 * This file is part of the OpenSprinkler project <http://opensprinkler.com>.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Configure module
var OSApp = OSApp || {};
OSApp.SiteMap = OSApp.SiteMap || {};

OSApp.SiteMap.Constants = {
	storagePrefix: "siteMap-",
	maxImageSize: 1600,
	imageQuality: 0.8,
	dragThreshold: 5,

	// Pins closer than this many pixels on screen are grouped into one marker
	clusterRadius: 32,

	// Normal zoom limit, which can rise up to maxZoomLimit so pins that are very close together can still be told apart
	maxZoom: 8,
	maxZoomLimit: 64,
	minMapHeight: 200,
	zoomStep: 2,

	// Length of the animated zooms (buttons, keys, double-click, tapping a group) in milliseconds; 0 jumps
	zoomDuration: 300,

	// Controller storage: smaller images fit embedded flash, pin positions are stored as 0-coordScale
	controllerImageSize: 1280,
	controllerImageQuality: 0.75,
	coordScale: 10000,

	// Base64 characters per upload request; a multiple of 4 that stays under the firmware's 8 KB body limit
	uploadChunkChars: 6000,
	pinSaveDelay: 500,

	// A failed upload is tried again after this long (ms), until it goes through
	retryDelay: 5000,

	// After a pan or zoom stops for this long (ms), valves are regrouped and everything is redrawn
	settleDelay: 150,

	// The first point of a run snaps to its valve when tapped within this many pixels of it
	snapRadius: 24
};

// Map data is stored locally per site:
// { image: <data URL>, pins: { <sid>: { x, y } }, drawings: { <sid>: [ { type: "heads" | "drip", pts: [ [ x, y ], ... ] } ] }, rev }
// with x/y from 0-1 across the image. pins are the valve positions; a "heads" run is a pipe with a head at every point.
// When the controller stores the map, this local copy is a cache and rev is the controller revision it matches.
OSApp.SiteMap.getStorageKey = function( siteName ) {
	return OSApp.SiteMap.Constants.storagePrefix + siteName;
};

OSApp.SiteMap.load = function( siteName, callback ) {
	var key = OSApp.SiteMap.getStorageKey( siteName );
	OSApp.Storage.get( key, function( data ) {
		var map;
		try {
			map = JSON.parse( data[ key ] );
		} catch {
			map = null;
		}
		if ( !map || typeof map !== "object" ) {
			map = {};
		}
		if ( typeof map.pins !== "object" || map.pins === null ) {
			map.pins = {};
		}
		if ( typeof map.drawings !== "object" || map.drawings === null ) {
			map.drawings = {};
		}
		callback( map );
	} );
};

// quiet skips the error message, for when the local copy is only a cache
OSApp.SiteMap.save = function( siteName, map, quiet ) {
	var data = {};
	data[ OSApp.SiteMap.getStorageKey( siteName ) ] = JSON.stringify( map );
	try {
		OSApp.Storage.set( data );
		return true;
	} catch {
		if ( !quiet ) {
			OSApp.Errors.showError( OSApp.Language._( "Unable to save site map. The image may be too large." ) );
		}
		return false;
	}
};

// Firmware that can store the map reports its revision as the "smap" option
OSApp.SiteMap.isControllerSupported = function() {
	return typeof OSApp.currentSession.controller?.options?.smap === "number";
};

OSApp.SiteMap.hasData = function( map ) {
	return !!( map && ( map.image || !$.isEmptyObject( map.pins ) || !$.isEmptyObject( map.drawings ) ) );
};

// Fewest points a run of each type needs to be kept
OSApp.SiteMap.minRunPoints = { heads: 1, drip: 2 };

// A branch starts on another run of the same station (run.branch), so a branch of heads also needs a head
OSApp.SiteMap.getMinPoints = function( run ) {
	return OSApp.SiteMap.minRunPoints[ run.type ] + ( run.branch && run.type === "heads" ? 1 : 0 );
};

// Keeps only well-formed runs for existing stations: { sid: [ run, ... ] } with no empty stations
OSApp.SiteMap.cleanDrawings = function( drawings, stationCount ) {
	var clean = {};

	$.each( drawings || {}, function( sid, runs ) {
		if ( !( Number( sid ) >= 0 && ( stationCount === undefined || Number( sid ) < stationCount ) ) || !Array.isArray( runs ) ) {
			return;
		}
		runs = runs.filter( function( run ) {
			return run && OSApp.SiteMap.minRunPoints[ run.type ] && Array.isArray( run.pts ) &&
				run.pts.length >= OSApp.SiteMap.getMinPoints( run ) &&
				run.pts.every( function( pt ) {
					return Array.isArray( pt ) && typeof pt[ 0 ] === "number" && typeof pt[ 1 ] === "number";
				} );
		} ).map( function( run ) {
			var clean = { type: run.type, pts: run.pts.map( function( pt ) {
				return [ Math.min( 1, Math.max( 0, pt[ 0 ] ) ), Math.min( 1, Math.max( 0, pt[ 1 ] ) ) ];
			} ) };
			if ( run.branch ) {
				clean.branch = true;
			}
			return clean;
		} );
		if ( runs.length ) {
			clean[ sid ] = runs;
		}
	} );
	return clean;
};

// Drawings to text, one run per line: "h,sid,x,y,x,y,..." for heads, "d,sid,..." for drip, x/y from 0 to coordScale.
// A branch uses the capital letter (H or D); its first point is where it joins another run.
OSApp.SiteMap.encodeDrawings = function( drawings ) {
	var scale = OSApp.SiteMap.Constants.coordScale,
		lines = [];

	Object.keys( drawings || {} ).map( Number ).sort( function( a, b ) {
		return a - b;
	} ).forEach( function( sid ) {
		drawings[ sid ].forEach( function( run ) {
			var letter = run.type === "heads" ? "h" : "d";
			lines.push( [ run.branch ? letter.toUpperCase() : letter, sid ].concat( run.pts.reduce( function( values, pt ) {
				return values.concat( Math.round( pt[ 0 ] * scale ), Math.round( pt[ 1 ] * scale ) );
			}, [] ) ).join( "," ) );
		} );
	} );
	return lines.length ? lines.join( "\n" ) + "\n" : "";
};

OSApp.SiteMap.decodeDrawings = function( text, stationCount ) {
	var scale = OSApp.SiteMap.Constants.coordScale,
		drawings = {};

	String( text || "" ).split( "\n" ).forEach( function( line ) {
		var fields = line.split( "," ),
			type = { h: "heads", d: "drip", H: "heads", D: "drip" }[ fields[ 0 ] ],
			sid = Number( fields[ 1 ] ),
			values = fields.slice( 2 ).map( Number ),
			pts = [],
			index;

		if ( !type || !Number.isInteger( sid ) || values.length % 2 || values.some( isNaN ) ) {
			return;
		}
		for ( index = 0; index < values.length; index += 2 ) {
			pts.push( [ values[ index ] / scale, values[ index + 1 ] / scale ] );
		}
		( drawings[ sid ] = drawings[ sid ] || [] ).push( fields[ 0 ] === fields[ 0 ].toUpperCase() ?
			{ type: type, branch: true, pts: pts } : { type: type, pts: pts } );
	} );
	return OSApp.SiteMap.cleanDrawings( drawings, stationCount );
};

// Kinds of station that look different on the map: master valves and Bundle Stations can't be run from it like a zone
OSApp.SiteMap.getStationKind = function( sid ) {
	if ( OSApp.Stations.isMaster( sid ) ) {
		return "master";
	}
	if ( OSApp.Bundles.isLeader( sid ) ) {
		return "bundle";
	}
	return "zone";
};

// Seconds left for a running station, following the home page's countdown when there is one
OSApp.SiteMap.getRemaining = function( sid ) {
	var timer = OSApp.uiState.timers && OSApp.uiState.timers[ "station-" + sid ];
	return timer && typeof timer.val === "number" ? timer.val : OSApp.Stations.getRemainingRuntime( sid );
};

// { sid: { x, y } } with x/y from 0-1 to "sid,x,y;..." with x/y from 0 to coordScale
OSApp.SiteMap.encodePins = function( pins ) {
	var scale = OSApp.SiteMap.Constants.coordScale,
		toInt = function( value ) {
			return Math.round( Math.min( 1, Math.max( 0, value ) ) * scale );
		};

	return Object.keys( pins ).map( Number ).sort( function( a, b ) {
		return a - b;
	} ).map( function( sid ) {
		return sid + "," + toInt( pins[ sid ].x ) + "," + toInt( pins[ sid ].y );
	} ).join( ";" );
};

// [ [ sid, x, y ], ... ] from /jm to { sid: { x, y } }
OSApp.SiteMap.decodePins = function( list ) {
	var scale = OSApp.SiteMap.Constants.coordScale,
		pins = {};

	( list || [] ).forEach( function( pin ) {
		pins[ pin[ 0 ] ] = { x: pin[ 1 ] / scale, y: pin[ 2 ] / scale };
	} );
	return pins;
};

// Splits a JPEG data URL into base64 upload chunks. Every chunk but the last is a whole number of
// 4-character groups, so it decodes on its own; offset and total count decoded bytes.
OSApp.SiteMap.getImageChunks = function( dataURL, chunkChars ) {
	var base64 = dataURL.slice( dataURL.indexOf( "," ) + 1 ),
		padding = ( base64.match( /=+$/ ) || [ "" ] )[ 0 ].length,
		chunks = [],
		position;

	chunkChars = chunkChars || OSApp.SiteMap.Constants.uploadChunkChars;
	for ( position = 0; position < base64.length; position += chunkChars ) {
		chunks.push( { offset: position / 4 * 3, body: base64.slice( position, position + chunkChars ) } );
	}
	return { total: base64.length / 4 * 3 - padding, chunks: chunks };
};

OSApp.SiteMap.fetchRemote = function() {
	return OSApp.Firmware.sendToOS( "/jm?pw=", "json" );
};

OSApp.SiteMap.downloadImage = function() {
	return OSApp.Firmware.sendToOS( "/jmi?pw=", "blob" ).then( function( blob ) {
		var defer = $.Deferred(),
			reader = new FileReader();

		reader.onload = function() {
			defer.resolve( reader.result );
		};
		reader.onerror = function() {
			defer.reject( reader.error );
		};
		reader.readAsDataURL( blob );
		return defer.promise();
	} );
};

// Sends data to the controller as the request body, or through OpenThings Cloud, which doesn't pass on POST
// requests with a body, as the URL parameter named param. An empty body is sent as a plain GET there.
OSApp.SiteMap.sendData = function( dest, param, data ) {
	if ( OSApp.currentSession.token ) {
		return OSApp.Firmware.sendToOS( data ? dest + "&" + param + "=" + encodeURIComponent( data ) : dest, "json" );
	}
	return OSApp.Firmware.sendToOS( dest, "json", { body: data } );
};

// Uploads the image chunk by chunk; onProgress receives the fraction sent so far
OSApp.SiteMap.uploadImage = function( dataURL, onProgress ) {
	var upload = OSApp.SiteMap.getImageChunks( dataURL ),
		controller = OSApp.currentSession.controller;

	onProgress = onProgress || function() {};
	return upload.chunks.reduce( function( previous, chunk, index ) {
		return previous.then( function() {

			// Stop if the app switched to another controller mid-upload
			if ( OSApp.currentSession.controller !== controller ) {
				return $.Deferred().reject( { status: 0, statusText: "stale" } );
			}
			return OSApp.SiteMap.sendData( "/um?pw=&off=" + chunk.offset + "&tot=" + upload.total, "d", chunk.body )
				.then( function() {
					onProgress( ( index + 1 ) / upload.chunks.length );
				} );
		} );
	}, $.Deferred().resolve().promise() );
};

OSApp.SiteMap.uploadPins = function( pins ) {
	var encoded = OSApp.SiteMap.encodePins( pins );

	// An empty body is ignored, so clearing all pins uses an empty p parameter instead
	return encoded ?
		OSApp.SiteMap.sendData( "/cmp?pw=", "p", encoded ) :
		OSApp.SiteMap.sendData( "/cmp?pw=&p=", "p", "" );
};

OSApp.SiteMap.downloadDrawings = function() {
	return OSApp.Firmware.sendToOS( "/jmd?pw=", "text" ).then( function( text ) {
		return OSApp.SiteMap.decodeDrawings( text );
	} );
};

// Uploads the drawings in plain text chunks; no drawings clears them on the controller
OSApp.SiteMap.uploadDrawings = function( drawings ) {
	var text = OSApp.SiteMap.encodeDrawings( drawings ),
		size = OSApp.SiteMap.Constants.uploadChunkChars,
		controller = OSApp.currentSession.controller,
		offsets = [],
		offset;

	if ( !text ) {
		return OSApp.SiteMap.sendData( "/umd?pw=&off=0&tot=0", "d", "" );
	}
	for ( offset = 0; offset < text.length; offset += size ) {
		offsets.push( offset );
	}
	return offsets.reduce( function( previous, start ) {
		return previous.then( function() {
			if ( OSApp.currentSession.controller !== controller ) {
				return $.Deferred().reject( { status: 0, statusText: "stale" } );
			}
			return OSApp.SiteMap.sendData( "/umd?pw=&off=" + start + "&tot=" + text.length, "d", text.slice( start, start + size ) );
		} );
	}, $.Deferred().resolve().promise() );
};

OSApp.SiteMap.deleteRemote = function() {
	return OSApp.SiteMap.sendData( "/dm?pw=", "d", "" );
};

// Uploads a whole map (image, pins, then drawings) and resolves with it, tagged with the new controller revision
OSApp.SiteMap.uploadMap = function( siteName, map, onProgress ) {
	var result = { image: map.image, pins: $.extend( {}, map.pins ), drawings: OSApp.SiteMap.cleanDrawings( map.drawings ) };

	return ( map.image ? OSApp.SiteMap.uploadImage( map.image, onProgress ) : $.Deferred().resolve().promise() )
		.then( function() {
			return OSApp.SiteMap.uploadPins( result.pins );
		} )
		.then( function() {
			return $.isEmptyObject( result.drawings ) ? null : OSApp.SiteMap.uploadDrawings( result.drawings );
		} )
		.then( OSApp.SiteMap.fetchRemote )
		.then( function( remote ) {
			result.rev = remote.rev;
			OSApp.SiteMap.save( siteName, result, true );
			return result;
		} );
};

// Brings the local cache up to date with the controller and resolves with the map. A map that only exists
// on this device is moved to the controller the first time, while the controller has none.
OSApp.SiteMap.syncFromController = function( siteName, cached ) {
	return OSApp.SiteMap.fetchRemote().then( function( remote ) {
		var map = { pins: OSApp.SiteMap.decodePins( remote.pins ), drawings: {}, rev: remote.rev },
			unchanged = cached.rev === remote.rev,
			finish = function() {
				OSApp.SiteMap.save( siteName, map, true );
				return map;
			},
			loadDrawings = function() {
				if ( !remote.drw ) {
					return finish();
				}
				if ( unchanged && cached.drawings ) {
					map.drawings = cached.drawings;
					return finish();
				}
				return OSApp.SiteMap.downloadDrawings().then( function( drawings ) {
					map.drawings = drawings;
					return finish();
				} );
			};

		if ( remote.rev === 0 && cached.rev === undefined && OSApp.SiteMap.hasData( cached ) ) {
			return OSApp.SiteMap.uploadMap( siteName, cached ).then( function( uploaded ) {
				OSApp.Errors.showError( OSApp.Language._( "Settings have been saved" ) );
				return uploaded;
			} );
		}
		if ( !remote.img ) {
			return loadDrawings();
		}
		if ( unchanged && cached.image ) {
			map.image = cached.image;
			return loadDrawings();
		}
		return OSApp.SiteMap.downloadImage().then( function( image ) {
			map.image = image;
			return loadDrawings();
		} );
	} );
};

// The current site's map for a config backup: { pins, drawings, image }, or null when there is none.
// Falls back to the copy on this device if the controller can't be reached.
OSApp.SiteMap.getBackupData = function( callback ) {
	OSApp.Storage.get( "current_site", function( data ) {
		var siteName = data.current_site || "default";

		OSApp.SiteMap.load( siteName, function( cached ) {
			var done = function( map ) {
				callback( OSApp.SiteMap.hasData( map ) ? { pins: map.pins, drawings: map.drawings || {}, image: map.image } : null );
			};

			if ( !OSApp.SiteMap.isControllerSupported() ) {
				done( cached );
				return;
			}
			OSApp.SiteMap.syncFromController( siteName, cached ).then( done, function() {
				done( cached );
			} );
		} );
	} );
};

// Restores a map from a config backup to the controller, or to this device when the controller can't store it.
// Pins for stations the controller doesn't have are dropped. Calls done when finished, even after a failure.
OSApp.SiteMap.restoreBackupData = function( backup, done ) {
	var stationCount = ( OSApp.currentSession.controller?.stations?.snames || [] ).length,
		map = { pins: {}, drawings: {} };

	if ( !backup || typeof backup !== "object" ) {
		done();
		return;
	}
	if ( typeof backup.image === "string" && /^data:image\/jpeg;base64,/.test( backup.image ) ) {
		map.image = backup.image;
	}
	$.each( backup.pins || {}, function( sid, pos ) {
		if ( Number( sid ) < stationCount && pos && typeof pos.x === "number" && typeof pos.y === "number" ) {
			map.pins[ sid ] = { x: pos.x, y: pos.y };
		}
	} );
	map.drawings = OSApp.SiteMap.cleanDrawings( backup.drawings, stationCount );

	OSApp.Storage.get( "current_site", function( data ) {
		var siteName = data.current_site || "default";

		if ( !OSApp.SiteMap.isControllerSupported() ) {
			OSApp.SiteMap.save( siteName, map );
			done();
			return;
		}
		OSApp.SiteMap.uploadMap( siteName, map ).then( done, function() {
			OSApp.Errors.showError( OSApp.Language._( "Unable to import configuration." ) );
			done();
		} );
	} );
};

// Loads the map from the controller when it can store one, otherwise from this device.
// callback( map, source ) where source is "controller" or "local".
OSApp.SiteMap.loadMap = function( siteName, callback ) {
	OSApp.SiteMap.load( siteName, function( cached ) {
		if ( !OSApp.SiteMap.isControllerSupported() ) {
			callback( cached, "local" );
			return;
		}
		OSApp.SiteMap.syncFromController( siteName, cached ).then( function( map ) {
			callback( map, "controller" );
		}, function( error ) {

			// Firmware without the site map endpoints
			if ( error && error.status === 404 ) {
				callback( cached, "local" );
				return;
			}
			OSApp.Errors.showError( OSApp.Language._( "Network Error" ) );
			callback( cached, "controller" );
		} );
	} );
};

OSApp.SiteMap.getPinState = function( sid ) {
	if ( OSApp.Stations.isDisabled( sid ) ) {
		return "disabled";
	}
	if ( OSApp.Stations.isRunning( sid ) ) {
		return "running";
	}
	if ( OSApp.Stations.getPID( sid ) ) {
		return "queued";
	}
	return "idle";
};

// Most important state first, used to color a group of pins
OSApp.SiteMap.statePriority = [ "running", "queued", "idle", "disabled" ];

OSApp.SiteMap.getClusterState = function( sids ) {
	var states = sids.map( OSApp.SiteMap.getPinState );
	for ( var i = 0; i < OSApp.SiteMap.statePriority.length; i++ ) {
		if ( states.indexOf( OSApp.SiteMap.statePriority[ i ] ) !== -1 ) {
			return OSApp.SiteMap.statePriority[ i ];
		}
	}
	return "idle";
};

// Greedily group pins whose on-screen distance from a group's center is within radius pixels.
// Returns [ { sids: [ ... ], x: 0-1, y: 0-1 } ] where x/y is the group's center.
OSApp.SiteMap.clusterPins = function( pins, width, height, radius ) {
	var clusters = [];

	Object.keys( pins ).map( Number ).sort( function( a, b ) {
		return a - b;
	} ).forEach( function( sid ) {
		var pos = pins[ sid ],
			match = null;

		if ( width > 0 && height > 0 ) {
			match = clusters.find( function( cluster ) {
				return Math.hypot( ( cluster.x - pos.x ) * width, ( cluster.y - pos.y ) * height ) <= radius;
			} );
		}

		if ( match ) {
			match.sids.push( sid );
			match.x += ( pos.x - match.x ) / match.sids.length;
			match.y += ( pos.y - match.y ) / match.sids.length;
		} else {
			clusters.push( { sids: [ sid ], x: pos.x, y: pos.y } );
		}
	} );

	return clusters;
};


// Smallest zoom at which every pin is drawn on its own, or null if they can't be separated within maxZoom
OSApp.SiteMap.getSeparatingScale = function( pins, width, height, radius, maxZoom ) {
	var sids = Object.keys( pins ),
		minDistance = Infinity,
		scale, i, j, a, b;

	for ( i = 0; i < sids.length; i++ ) {
		for ( j = i + 1; j < sids.length; j++ ) {
			a = pins[ sids[ i ] ];
			b = pins[ sids[ j ] ];
			minDistance = Math.min( minDistance, Math.hypot( ( a.x - b.x ) * width, ( a.y - b.y ) * height ) );
		}
	}

	if ( !( minDistance > 0 ) ) {
		return null;
	}

	// Start where the closest pair is just over the grouping radius apart, then step up until grouping agrees
	for ( scale = Math.max( 1, radius * 1.25 / minDistance ); scale < maxZoom; scale *= 1.25 ) {
		if ( OSApp.SiteMap.clusterPins( pins, width * scale, height * scale, radius ).length === sids.length ) {
			return scale;
		}
	}
	return OSApp.SiteMap.clusterPins( pins, width * maxZoom, height * maxZoom, radius ).length === sids.length ? maxZoom : null;
};

// How far the map may zoom in: the normal limit, or further if that's what it takes to separate the closest pins.
// Pins at exactly the same spot can never be separated, so they are counted once.
OSApp.SiteMap.getMaxZoom = function( pins, width, height, radius ) {
	var Constants = OSApp.SiteMap.Constants,
		distinct = {},
		seen = {},
		scale;

	$.each( pins, function( sid, pos ) {
		var key = pos.x + "," + pos.y;
		if ( !seen[ key ] ) {
			seen[ key ] = true;
			distinct[ sid ] = pos;
		}
	} );

	if ( Object.keys( distinct ).length < 2 || !( width > 0 && height > 0 ) ) {
		return Constants.maxZoom;
	}

	scale = OSApp.SiteMap.getSeparatingScale( distinct, width, height, radius, Constants.maxZoomLimit );
	return scale === null ? Constants.maxZoomLimit : Math.max( Constants.maxZoom, scale );
};

// Disabled stations are shown only when Show Disabled is on in the footer menu, like the station cards
OSApp.SiteMap.isStationShown = function( sid ) {
	return OSApp.Storage.getItemSync( "showDisabled" ) === "true" || !OSApp.Stations.isDisabled( sid );
};

// Smooth curve through points ({ x, y }), as one cubic Bezier segment { from, c1, c2, to } per pair of points.
// Each point's tangent follows the line between its neighbours, so the curve bends through it without a corner;
// control points sit a third of the segment's length out, so a long segment beside a short one doesn't loop.
OSApp.SiteMap.getCurve = function( points ) {
	var tangents = points.map( function( pt, i ) {
			var before = points[ Math.max( 0, i - 1 ) ],
				after = points[ Math.min( points.length - 1, i + 1 ) ],
				dx = after.x - before.x,
				dy = after.y - before.y,
				length = Math.hypot( dx, dy );

			return length ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
		} ),
		segments = [],
		i, length;

	for ( i = 0; i < points.length - 1; i++ ) {
		length = Math.hypot( points[ i + 1 ].x - points[ i ].x, points[ i + 1 ].y - points[ i ].y ) / 3;
		segments.push( {
			from: points[ i ],
			c1: { x: points[ i ].x + tangents[ i ].x * length, y: points[ i ].y + tangents[ i ].y * length },
			c2: { x: points[ i + 1 ].x - tangents[ i + 1 ].x * length, y: points[ i + 1 ].y - tangents[ i + 1 ].y * length },
			to: points[ i + 1 ]
		} );
	}
	return segments;
};

// Size of an image with the given aspect ratio (height / width) that covers a viewport, cropping what doesn't fit.
// Without a ratio (no image yet) it is the viewport itself.
OSApp.SiteMap.getCoverSize = function( ratio, viewWidth, viewHeight ) {
	var width;

	if ( !ratio ) {
		return { width: viewWidth, height: viewHeight };
	}
	width = Math.max( viewWidth, viewHeight / ratio );
	return { width: width, height: width * ratio };
};

// The point on a curve (segments from getCurve) closest to point, found by sampling each segment and then
// narrowing in around the best sample
OSApp.SiteMap.nearestOnCurve = function( segments, point ) {
	var at = function( segment, t ) {
			var u = 1 - t;
			return {
				x: u * u * u * segment.from.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.to.x,
				y: u * u * u * segment.from.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.to.y
			};
		},
		distance = function( pt ) {
			return Math.hypot( pt.x - point.x, pt.y - point.y );
		},
		steps = 32,
		best = null;

	segments.forEach( function( segment ) {
		var step, t, low, high, a, b;

		for ( step = 0; step <= steps; step++ ) {
			t = step / steps;
			if ( !best || distance( at( segment, t ) ) < best.distance ) {
				best = { segment: segment, t: t, distance: distance( at( segment, t ) ) };
			}
		}
		if ( best.segment !== segment ) {
			return;
		}
		low = Math.max( 0, best.t - 1 / steps );
		high = Math.min( 1, best.t + 1 / steps );
		for ( step = 0; step < 30; step++ ) {
			a = low + ( high - low ) / 3;
			b = high - ( high - low ) / 3;
			if ( distance( at( segment, a ) ) < distance( at( segment, b ) ) ) {
				high = b;
			} else {
				low = a;
			}
		}
		t = ( low + high ) / 2;
		if ( distance( at( segment, t ) ) < best.distance ) {
			best = { segment: segment, t: t, distance: distance( at( segment, t ) ) };
		}
	} );
	return best ? at( best.segment, best.t ) : null;
};

// A view is { scale, x, y }: the image is drawn at scale times its fitted size (width x height), with its top-left
// corner offset x, y pixels. viewport ({ width, height, minScale }) is the visible area, the fitted size when omitted,
// and minScale the furthest it may zoom out (1 when omitted). Along each axis the image is kept covering the viewport,
// or centered in it while smaller.
// overscrollRight lets the map be dragged that many pixels further left than its right edge, so whatever
// is under the buttons along the right side can be moved out from under them, even at normal zoom
OSApp.SiteMap.clampView = function( view, width, height, maxZoom, overscrollRight, viewport ) {
	var viewWidth = viewport ? viewport.width : width,
		viewHeight = viewport ? viewport.height : height,
		minScale = viewport && viewport.minScale ? viewport.minScale : 1,
		scale = Math.min( maxZoom, Math.max( minScale, view.scale ) ),
		clamp = function( offset, size, visible, overscroll ) {
			var center = ( visible - size ) / 2,
				lowest = visible - size - overscroll;

			if ( size <= visible ) {
				return Math.min( center, Math.max( Math.min( center, lowest ), offset ) );
			}
			return Math.min( 0, Math.max( lowest, offset ) );
		};

	return {
		scale: scale,
		x: clamp( view.x, width * scale, viewWidth, overscrollRight || 0 ),
		y: clamp( view.y, height * scale, viewHeight, 0 )
	};
};

// Zoom by factor while keeping the point (px, py) of the viewport fixed on screen
OSApp.SiteMap.zoomAt = function( view, factor, px, py, width, height, maxZoom, viewport ) {
	var scale = Math.min( maxZoom, Math.max( viewport && viewport.minScale ? viewport.minScale : 1, view.scale * factor ) ),
		ratio = scale / view.scale;

	return OSApp.SiteMap.clampView( {
		scale: scale,
		x: px - ( px - view.x ) * ratio,
		y: py - ( py - view.y ) * ratio
	}, width, height, maxZoom, 0, viewport );
};

// Which view the home page shows: "cards" (station cards) or "map" (the site map), remembered per device
OSApp.SiteMap.getHomeView = function() {
	return OSApp.Storage.getItemSync( "homeView" ) === "map" ? "map" : "cards";
};

// Adds the site map to the home page, with a floating button above the menu button that switches between
// the station cards and the map. The button shows the icon of the view it switches to.
OSApp.SiteMap.attachToHome = function( page ) {
	var toggle = $( "<a href='#' class='home-view-button ui-corner-all ui-btn ui-btn-icon-notext ui-btn-inline'></a>" ),
		view = OSApp.SiteMap.createView(),
		shown = false,
		apply = function() {
			var mode = OSApp.SiteMap.getHomeView(),
				label = mode === "map" ? OSApp.Language._( "Stations" ) : OSApp.Language._( "Site Map" );

			toggle.toggleClass( "ui-icon-bullets", mode === "map" )
				.toggleClass( "ui-icon-location", mode !== "map" )
				.attr( { title: label, "aria-label": label } )
				.text( label );
			page.toggleClass( "home-map-view", mode === "map" )
				.find( "#os-stations-list" ).toggle( mode === "cards" );
			view.root.toggle( mode === "map" );
			if ( mode === "map" && shown ) {
				view.activate();
			} else {
				view.deactivate();
			}

			// The page's height changes with the view, so stretch it to the window again
			if ( shown && page.hasClass( $.mobile.activePageClass ) ) {
				$.mobile.resetActivePageHeight();
			}
		};

	page.find( ".info-card" ).first().after( view.root );
	page.append( toggle );
	toggle.on( "click", function() {
		OSApp.SiteMap.setHomeView( OSApp.SiteMap.getHomeView() === "map" ? "cards" : "map" );
		return false;
	} );
	page.on( {
		pageshow: function() {
			shown = true;
			apply();
		},
		pagehide: function() {
			shown = false;
			view.deactivate();
		}
	} );
	page.data( "siteMapApply", apply );
	apply();
};

// Switches the home page between the station cards and the site map
OSApp.SiteMap.setHomeView = function( mode ) {
	var apply = $( "#sprinklers" ).data( "siteMapApply" );

	OSApp.Storage.setItemSync( "homeView", mode === "map" ? "map" : "cards" );
	if ( apply ) {
		apply();
	}
};

// Builds the interactive site map. Returns { root, activate, deactivate }: activate loads the current site's map
// and starts listening for refreshes and keys, deactivate saves pending changes and stops listening.
OSApp.SiteMap.createView = function() {
	var SVG_NS = "http://www.w3.org/2000/svg",

		// Valve symbol: two triangles meeting at the valve, with an actuator on top
		VALVE_ICON = "<svg class='site-map-valve' viewBox='0 0 20 20' aria-hidden='true'>" +
			"<path d='M3 6L10 11L3 16Z M17 6L10 11L17 16Z' fill='#fff'/>" +
			"<path d='M10 11V4 M7 4H13' stroke='#fff' stroke-width='2' fill='none'/></svg>",
		page = $( `
			<div class="site-map-view">
				<div class="site-map-container">
					<img class="site-map-image-el" alt="">
					<svg class="site-map-drawings" xmlns="http://www.w3.org/2000/svg"></svg>
					<div class="site-map-pins"></div>
					<div class="site-map-drawbar">
						<span class="site-map-drawbar-label"></span>
						<a href="#" title="${OSApp.Language._( "Undo point" )}" class="site-map-draw-undo ui-btn ui-btn-icon-notext ui-icon-back ui-corner-all ui-mini">${OSApp.Language._( "Undo point" )}</a>
						<a href="#" title="${OSApp.Language._( "Done" )}" class="site-map-draw-done ui-btn ui-btn-icon-notext ui-icon-check ui-corner-all ui-mini">${OSApp.Language._( "Done" )}</a>
						<a href="#" title="${OSApp.Language._( "Cancel" )}" class="site-map-draw-cancel ui-btn ui-btn-icon-notext ui-icon-delete ui-corner-all ui-mini">${OSApp.Language._( "Cancel" )}</a>
					</div>
					<p class="site-map-hint center"></p>
					<p class="site-map-loading-text center">${OSApp.Language._( "Loading" )}...</p>
					<div class="site-map-empty-prompt center">
						<p>${OSApp.Language._( "Add a photo or drawing of your property, then place your stations on it to see and control them from the map." )}</p>
						<a href="#" class="site-map-add-image ui-btn ui-btn-inline ui-btn-icon-left ui-icon-camera ui-corner-all">${OSApp.Language._( "Add" )}</a>
					</div>
					<div class="site-map-controls">
						<div class="site-map-toolbar">
							<a href="#" title="${OSApp.Language._( "Edit" )}" class="site-map-edit ui-btn ui-btn-icon-notext ui-icon-edit ui-corner-all ui-mini">${OSApp.Language._( "Edit" )}</a>
							<a href="#" title="${OSApp.Language._( "Cancel" )}" class="site-map-cancel ui-btn ui-btn-icon-notext ui-icon-delete ui-corner-all ui-mini red">${OSApp.Language._( "Cancel" )}</a>
							<a href="#" title="${OSApp.Language._( "Image" )}" class="site-map-image ui-btn ui-btn-icon-notext ui-icon-camera ui-corner-all ui-mini">${OSApp.Language._( "Image" )}</a>
							<a href="#" title="${OSApp.Language._( "Clear" )}" class="site-map-clear ui-btn ui-btn-icon-notext ui-icon-back ui-corner-all ui-mini">${OSApp.Language._( "Clear" )}</a>
						</div>
						<div class="site-map-zoom">
							<a href="#" title="${OSApp.Language._( "Zoom In" )} (+)" class="site-map-zoom-in ui-btn ui-btn-icon-notext ui-icon-plus ui-corner-all ui-mini">${OSApp.Language._( "Zoom In" )}</a>
							<a href="#" title="${OSApp.Language._( "Zoom Out" )} (-)" class="site-map-zoom-out ui-btn ui-btn-icon-notext ui-icon-minus ui-corner-all ui-mini">${OSApp.Language._( "Zoom Out" )}</a>
							<a href="#" title="${OSApp.Language._( "Reset Zoom" )} (0)" class="site-map-zoom-reset ui-btn ui-btn-icon-notext ui-icon-refresh ui-corner-all ui-mini">${OSApp.Language._( "Reset Zoom" )}</a>
						</div>
					</div>
				</div>
			</div>
	` ),
		Constants = OSApp.SiteMap.Constants,
		container = page.find( ".site-map-container" ),
		image = page.find( ".site-map-image-el" ),
		pinLayer = page.find( ".site-map-pins" ),
		drawLayer = page.find( ".site-map-drawings" ),
		drawbar = page.find( ".site-map-drawbar" ),
		hint = page.find( ".site-map-hint" ),
		siteName = null,
		map = { pins: {}, drawings: {} },
		source = "local",
		pinSaveTimer = null,
		dirty = { pins: false, drawings: false, image: false },

		// The map as it was when editing started, restored if the edit is cancelled
		editSnapshot = null,

		// The run being drawn: { sid, run, isNew, original }
		drawing = null,

		// A run point being dragged: { sid, runIndex, pointIndex, moved }
		handleDrag = null,
		pendingRequests = 0,
		editing = false,
		placingSid = null,
		view = { scale: 1, x: 0, y: 0 },

		// Whether the view is the starting one (Reset Zoom), which is kept when the map is resized
		atHome = true,

		// Whether the last upload failed and is waiting to be tried again
		uploadFailed = false,
		maxZoomCache = {},
		lastWidth = 0,
		drag = null,
		pointers = {},
		gesture = null,
		gestureScale = 1,
		animationFrame = null,
		renderQueued = false,
		moveQueued = false,
		settleTimer = null,

		// The drawings group and the view it was drawn for, so moves can be applied as a transform
		drawRoot = null,
		renderedView = null,
		timeTimer = null;

	// Records changes to the pins and/or drawings. While editing they are kept until Done; otherwise they are
	// saved right away, and on the controller they are batched so dragging sends one request
	function persist( kinds ) {
		( kinds || [ "pins" ] ).forEach( function( kind ) {
			dirty[ kind ] = true;
		} );
		if ( editing ) {
			return;
		}
		OSApp.SiteMap.save( siteName, map, source === "controller" );
		if ( source === "controller" ) {
			clearTimeout( pinSaveTimer );
			pinSaveTimer = setTimeout( uploadChanges, Constants.pinSaveDelay );
		}
	}

	function uploadChanges() {
		var changed = dirty,
			retrying = uploadFailed,
			request = $.Deferred().resolve().promise();

		clearTimeout( pinSaveTimer );
		pinSaveTimer = null;
		dirty = { pins: false, drawings: false, image: false };
		if ( changed.image && map.image ) {
			request = request.then( function() {
				showUploadProgress( 0 );
				return OSApp.SiteMap.uploadImage( map.image, showUploadProgress ).always( function() {
					$.mobile.loading( "hide" );
				} );
			} );
		}
		if ( changed.pins ) {
			request = request.then( function() {
				return OSApp.SiteMap.uploadPins( map.pins );
			} );
		}
		if ( changed.drawings ) {
			request = request.then( function() {
				return OSApp.SiteMap.uploadDrawings( map.drawings );
			} );
		}
		request = request.then( refreshRevision ).then( function() {
			uploadFailed = false;
			if ( retrying ) {
				showSaved();
			}
		}, function( error ) {

			// Part of the change may already be on the controller, so send all of it again later. Until then the
			// timer keeps checkForRemoteChanges from replacing the map with the partly saved one.
			if ( error && ( error.statusText === "stale" || error.status === 401 ) ) {
				return;
			}
			$.each( changed, function( kind, value ) {
				dirty[ kind ] = dirty[ kind ] || value;
			} );
			if ( !uploadFailed ) {
				OSApp.Errors.showError( OSApp.Language._( "Network Error" ) );
			}
			uploadFailed = true;
			clearTimeout( pinSaveTimer );
			pinSaveTimer = setTimeout( uploadChanges, Constants.retryDelay );
			return $.Deferred().reject( error );
		} );
		return track( request );
	}

	// Confirms a saved edit, like the options pages do
	function showSaved() {
		OSApp.Errors.showError( OSApp.Language._( "Settings have been saved" ) );
	}

	// Counts requests in flight so a data refresh doesn't reload the map while it is being saved
	function track( request ) {
		pendingRequests++;
		return request.always( function() {
			pendingRequests--;
		} );
	}

	// Records the controller revision matching what is on screen, so the cached image stays valid
	function refreshRevision() {
		return OSApp.SiteMap.fetchRemote().then( function( remote ) {
			map.rev = remote.rev;
			OSApp.SiteMap.save( siteName, map, true );
		} );
	}

	function showMap( loaded, loadedSource ) {
		var previousImage = map.image;

		map = loaded;
		map.drawings = map.drawings || {};
		source = loadedSource;
		if ( map.image !== previousImage ) {
			image.attr( "src", map.image || "" );
		}
		updateHint();
		fitMap();
		renderPins();
	}

	function endEditSession( discard ) {
		var snapshot = editSnapshot;

		editSnapshot = null;
		if ( discard && snapshot ) {
			if ( snapshot.image !== map.image ) {
				image.attr( "src", snapshot.image || "" );
			}
			map.image = snapshot.image;
			map.pins = snapshot.pins;
			map.drawings = snapshot.drawings;
			dirty = { pins: false, drawings: false, image: false };
			fitMap();
			return;
		}
		if ( !dirty.pins && !dirty.drawings && !dirty.image ) {
			return;
		}
		if ( source === "controller" ) {
			OSApp.SiteMap.save( siteName, map, true );
			saveUnlessChangedElsewhere( snapshot ? snapshot.rev : undefined );
			return;
		}
		dirty = { pins: false, drawings: false, image: false };
		if ( OSApp.SiteMap.save( siteName, map ) ) {
			showSaved();
		} else if ( snapshot ) {

			// Not enough room on this device for the new image; keep the rest of the changes
			map.image = snapshot.image;
			image.attr( "src", map.image || "" );
			OSApp.SiteMap.save( siteName, map );
		}
	}

	// Before uploading an edit, makes sure nobody saved the map from another device since editing started;
	// if they did, asks whether to overwrite their changes or load them and drop this edit
	function saveUnlessChangedElsewhere( startRev ) {
		var save = function() {
			return uploadChanges().then( showSaved );
		};

		track( OSApp.SiteMap.fetchRemote().then( function( remote ) {
			var decided = $.Deferred();

			if ( startRev === undefined || remote.rev === startRev ) {
				return save();
			}
			OSApp.UIDom.areYouSure( OSApp.Language._( "The site map was changed on another device. Save your changes anyway?" ), "",
				function() {
					save().always( decided.resolve );
				},
				function() {
					dirty = { pins: false, drawings: false, image: false };
					OSApp.SiteMap.syncFromController( siteName, {} ).then( function( loaded ) {
						showMap( loaded, "controller" );
					} ).always( decided.resolve );
				} );
			return decided.promise();
		}, save ) );
	}

	// Picks up changes saved from other devices
	function checkForRemoteChanges() {
		var rev = OSApp.currentSession.controller?.options?.smap;

		if ( source !== "controller" || typeof rev !== "number" || rev === map.rev || editing || drag || handleDrag ||
			pinSaveTimer || pendingRequests ) {
			return;
		}
		track( OSApp.SiteMap.syncFromController( siteName, map ).then( function( loaded ) {
			if ( !editing && !drag && !pinSaveTimer ) {
				showMap( loaded, "controller" );
			}
		} ) );
	}

	function showUploadProgress( fraction ) {
		$.mobile.loading( "show", {
			text: OSApp.Language._( "Loading" ) + " " + Math.round( fraction * 100 ) + "%",
			textVisible: true
		} );
	}

	function copyMap( from ) {
		return { image: from.image, pins: $.extend( true, {}, from.pins ), drawings: $.extend( true, {}, from.drawings ), rev: from.rev };
	}

	// Starts or ends editing. Ending saves the changes made since editing started, unless discard is set,
	// which puts the map back the way it was.
	function setEditing( value, discard ) {
		if ( drawing ) {
			if ( discard ) {
				cancelDrawing();
			} else {
				finishDrawing();
			}
		}
		if ( value && !editing ) {
			editSnapshot = copyMap( map );
		} else if ( !value && editing ) {
			endEditSession( discard );
		}
		editing = value;
		placingSid = null;
		page.toggleClass( "site-map-editing", editing );
		page.find( ".site-map-image, .site-map-clear, .site-map-cancel" ).toggle( editing );
		page.find( ".site-map-edit" )
			.toggleClass( "ui-icon-edit", !editing )
			.toggleClass( "ui-icon-check green", editing )
			.attr( "title", editing ? OSApp.Language._( "Done" ) : OSApp.Language._( "Edit" ) )
			.text( editing ? OSApp.Language._( "Done" ) : OSApp.Language._( "Edit" ) );

		// Redraw to show or hide the point handles
		renderPins();
	}

	function updateHint() {
		var text = "";
		if ( !map.image ) {

			// The empty-state prompt explains what to do
			text = "";
		} else if ( drawing ) {
			text = drawing.run.type === "heads" ?
				OSApp.Language._( "Add heads" ) + ": " + OSApp.Stations.getName( drawing.sid ) :
				OSApp.Language._( "Add drip line" ) + ": " + OSApp.Stations.getName( drawing.sid );
		} else if ( placingSid !== null ) {
			text = OSApp.Language._( "Move valve" ) + ": " + OSApp.Stations.getName( placingSid );
		} else if ( editing ) {
			text = OSApp.Language._( "Tap to add a valve. Tap a valve to draw its heads or drip lines." );
		} else if ( $.isEmptyObject( map.pins ) ) {
			text = OSApp.Language._( "No stations have been placed. Tap Edit to add stations to the map." );
		}
		hint.text( text ).toggle( text !== "" );

		// Until the map has loaded, show a loading message rather than the prompt to add an image
		container.toggleClass( "site-map-empty", mapLoaded && !map.image );
		container.toggleClass( "site-map-loading", !mapLoaded );
		container.toggleClass( "site-map-loading-blank", !mapLoaded && !map.image );
	}

	// The map fills the free area of the screen, so the page doesn't scroll; the image covers it (see getSize)
	function fitMap() {
		var content = page.closest( ".ui-content" ),
			size,
			bottom = ( parseFloat( content.css( "padding-bottom" ) ) || 0 ) + ( parseFloat( page.closest( ".ui-page" ).css( "padding-bottom" ) ) || 0 ) +
				( parseFloat( page.css( "margin-bottom" ) ) || 0 ),
			width = content.width(),
			height = Math.max( Constants.minMapHeight, window.innerHeight - container.offset().top - bottom );

		container.css( { width: Math.floor( width ) + "px", height: Math.floor( height ) + "px" } );
		size = getSize();
		image.css( { width: size.width + "px", height: size.height + "px" } );
		stretchPage();
	}

	// The map's size sets the page's height, and jQuery Mobile only stretches a page to the window when it is
	// shown, so stretch it again whenever the map is resized (otherwise the dark background shows below it)
	function stretchPage() {
		if ( page.closest( ".ui-page" ).hasClass( $.mobile.activePageClass ) ) {
			$.mobile.resetActivePageHeight();
		}
	}

	// Refits the map when anything above it changes size, such as the weather loading into the card above
	function watchLayoutAbove() {
		var above = page.prevAll().toArray();

		if ( typeof ResizeObserver !== "function" || !above.length ) {
			return;
		}
		layoutObserver = new ResizeObserver( function() {
			if ( active ) {
				onResize();
			}
		} );
		above.forEach( function( element ) {
			layoutObserver.observe( element );
		} );
	}

	// Empty until the controller's data has loaded
	function getStationNames() {
		var stations = OSApp.currentSession.controller.stations;
		return ( stations && stations.snames ) || [];
	}

	// How far past its right edge the map may be dragged: the width of the button column plus a gap
	function getOverscroll() {
		var controls = container.find( ".site-map-controls" );
		return controls.is( ":visible" ) ? controls.outerWidth() + 8 : 0;
	}

	// Size of the image at normal zoom: just large enough to cover the map, with whatever doesn't fit cropped
	function getSize() {
		var img = image[ 0 ],
			ratio = map.image && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0;

		return OSApp.SiteMap.getCoverSize( ratio, container.width(), container.height() );
	}

	// The visible area, and how far out it may zoom: until the whole image fits
	function getViewport() {
		var size = getSize(),
			width = container.width(),
			height = container.height();

		return {
			width: width,
			height: height,
			minScale: size.width && size.height ? Math.min( 1, width / size.width, height / size.height ) : 1
		};
	}

	// Whether the image is larger than the map, so dragging pans it
	function canPan() {
		var size = getSize(),
			viewport = getViewport();
		return size.width * view.scale > viewport.width + 0.5 || size.height * view.scale > viewport.height + 0.5;
	}

	// Position of a map point (0-1) within the viewport, in pixels
	function toScreen( pos ) {
		var size = getSize();
		return {
			left: view.x + pos.x * size.width * view.scale,
			top: view.y + pos.y * size.height * view.scale
		};
	}

	// Map point (0-1) under a pointer, accounting for zoom and pan
	function getRelativePosition( event, offsetX, offsetY ) {
		var e = nativeEvent( event ),
			rect = container[ 0 ].getBoundingClientRect(),
			size = getSize();
		return {
			x: Math.min( 1, Math.max( 0, ( e.clientX - ( offsetX || 0 ) - rect.left - view.x ) / ( size.width * view.scale ) ) ),
			y: Math.min( 1, Math.max( 0, ( e.clientY - ( offsetY || 0 ) - rect.top - view.y ) / ( size.height * view.scale ) ) )
		};
	}

	// fromAnimation is set by animateView; any other change, such as a drag or pinch, stops a running animation.
	// moving marks a step of a continuous change (drag, pinch, wheel, animation), drawn with the fast path.
	function setView( next, fromAnimation, moving ) {
		var size = getSize();

		if ( !fromAnimation ) {
			stopAnimation();
			atHome = false;
		}
		view = OSApp.SiteMap.clampView( next, size.width, size.height, getMaxZoom(), getOverscroll(), getViewport() );
		lastWidth = size.width;
		image.css( "transform", "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")" );
		container.toggleClass( "site-map-zoomed", canPan() );
		if ( moving || fromAnimation ) {
			scheduleMove();
		} else {
			scheduleRender();
		}
	}

	function stopAnimation() {
		if ( animationFrame ) {
			window.cancelAnimationFrame( animationFrame );
			animationFrame = null;
		}
	}

	// Moves smoothly to a view. The zoom changes at a steady rate (geometrically) while the point at the
	// center of the map moves to its new spot, so zooming into a point looks like flying toward it.
	function animateView( next ) {
		var size = getSize(),
			viewport = getViewport(),
			width = size.width,
			height = size.height,
			start = view,
			end = OSApp.SiteMap.clampView( next, width, height, getMaxZoom(), getOverscroll(), viewport ),
			center = function( v ) {
				return { x: ( viewport.width / 2 - v.x ) / ( width * v.scale ), y: ( viewport.height / 2 - v.y ) / ( height * v.scale ) };
			},
			from = center( start ),
			to = center( end ),
			began = null,
			reduceMotion = window.matchMedia && window.matchMedia( "(prefers-reduced-motion: reduce)" ).matches;

		stopAnimation();
		atHome = false;
		if ( !Constants.zoomDuration || reduceMotion || !width || !height ) {
			setView( end );
			return;
		}

		animationFrame = window.requestAnimationFrame( function step( now ) {
			began = began === null ? now : began;

			var t = Math.min( 1, ( now - began ) / Constants.zoomDuration ),
				eased = 1 - Math.pow( 1 - t, 3 ),
				scale = start.scale * Math.pow( end.scale / start.scale, eased ),
				x = from.x + ( to.x - from.x ) * eased,
				y = from.y + ( to.y - from.y ) * eased;

			setView( t < 1 ? { scale: scale, x: viewport.width / 2 - x * width * scale, y: viewport.height / 2 - y * height * scale } : end, true );
			animationFrame = t < 1 ? window.requestAnimationFrame( step ) : null;
			if ( t >= 1 ) {
				scheduleRender();
			}
		} );
	}

	// animate moves there smoothly instead of jumping
	function goToView( next, animate ) {
		if ( animate ) {
			animateView( next );
		} else {
			setView( next );
		}
	}

	// The starting view: the image covers the map, centered
	function resetView( animate ) {
		var size = getSize(),
			viewport = getViewport();

		goToView( { scale: 1, x: ( viewport.width - size.width ) / 2, y: ( viewport.height - size.height ) / 2 }, animate );
		atHome = true;
	}

	// moving: one step of a continuous zoom (wheel, trackpad pinch)
	function zoomBy( factor, px, py, animate, moving ) {
		var size = getSize(),
			viewport = getViewport(),
			next;
		if ( px === undefined ) {
			px = viewport.width / 2;
			py = viewport.height / 2;
		}
		next = OSApp.SiteMap.zoomAt( view, factor, px, py, size.width, size.height, getMaxZoom(), viewport );
		if ( moving ) {
			setView( next, false, true );
		} else {
			goToView( next, animate );
		}
	}

	// Zoom in and center on a map point
	function zoomTo( pos, scale, animate ) {
		var size = getSize(),
			viewport = getViewport();
		scale = Math.min( getMaxZoom(), scale );
		goToView( {
			scale: scale,
			x: viewport.width / 2 - pos.x * size.width * scale,
			y: viewport.height / 2 - pos.y * size.height * scale
		}, animate );
	}

	function scheduleRender() {
		clearTimeout( settleTimer );
		settleTimer = null;
		if ( renderQueued ) {
			return;
		}
		renderQueued = true;
		window.requestAnimationFrame( function() {
			renderQueued = false;
			renderPins();
		} );
	}

	// Moves what is drawn on the next frame, then redraws fully once the view has been still for a moment
	function scheduleMove() {
		clearTimeout( settleTimer );
		settleTimer = setTimeout( function() {
			settleTimer = null;
			scheduleRender();
		}, Constants.settleDelay );
		if ( moveQueued ) {
			return;
		}
		moveQueued = true;
		window.requestAnimationFrame( function() {
			moveQueued = false;
			repositionLayers();
		} );
	}

	// Pins of stations that still exist and aren't hidden as disabled
	function getVisiblePins() {
		var stationCount = getStationNames().length,
			visible = {};

		$.each( map.pins, function( sid, pos ) {
			sid = parseInt( sid, 10 );
			if ( !isNaN( sid ) && sid < stationCount && OSApp.SiteMap.isStationShown( sid ) ) {
				visible[ sid ] = pos;
			}
		} );
		return visible;
	}

	// Recomputed only when the map size or the pins change, since it's needed on every frame of a pan or zoom
	function getMaxZoom() {
		var size = getSize(),
			pins = getVisiblePins(),
			key = size.width + "x" + size.height + ":" + JSON.stringify( pins );

		if ( maxZoomCache.key !== key ) {
			maxZoomCache = { key: key, value: OSApp.SiteMap.getMaxZoom( pins, size.width, size.height, Constants.clusterRadius ) };
		}
		return maxZoomCache.value;
	}

	function renderPins() {
		var stationCount = getStationNames().length,
			size = getSize(),
			visible = getVisiblePins();

		pinLayer.empty();

		// Grouping uses the zoomed size, so groups split apart as the map is zoomed in
		OSApp.SiteMap.clusterPins( visible, size.width * view.scale, size.height * view.scale, Constants.clusterRadius ).forEach( function( cluster ) {
			var isGroup = cluster.sids.length > 1,
				names = cluster.sids.map( function( sid ) {
					return OSApp.Stations.getName( sid );
				} ).join( ", " ),
				screen = toScreen( cluster );

			var sid = cluster.sids[ 0 ],
				running = !isGroup && OSApp.SiteMap.getPinState( sid ) === "running";

			// No visible label so pins don't cover the map; names show as a tooltip and in the dialogs opened by a tap.
			// Running valves show their time left, and masters and Bundle Stations are marked.
			$( "<div class='site-map-pin'><span class='site-map-pin-head'>" + ( isGroup ? "<span class='site-map-pin-count'></span>" : VALVE_ICON ) +
				"</span>" + ( isGroup ? "" : kindBadge( sid, "site-map-pin-badge" ) ) + ( running ? "<span class='site-map-pin-time'></span>" : "" ) +
				"</div>" )
				.attr( { "data-sids": cluster.sids.join( "," ), "data-x": cluster.x, "data-y": cluster.y, title: names, "aria-label": names } )
				.toggleClass( "site-map-pin-group", isGroup )
				.addClass( "site-map-pin-" + OSApp.SiteMap.getClusterState( cluster.sids ) )
				.addClass( isGroup ? "" : "site-map-pin-kind-" + OSApp.SiteMap.getStationKind( sid ) )
				.css( { left: screen.left + "px", top: screen.top + "px" } )
				.find( ".site-map-pin-count" ).text( isGroup ? cluster.sids.length : "" ).end()
				.appendTo( pinLayer );
		} );

		renderDrawings( stationCount );
		updateTimes();
		updateHint();
	}

	// A short marker for stations that aren't ordinary zones: "M" for master valves, the station type's badge otherwise
	function kindBadge( sid, className ) {
		var text = OSApp.Stations.isMaster( sid ) ? "M" : OSApp.Stations.getSpecialBadge( sid );
		return text ? "<span class='" + className + "'>" + OSApp.Utils.htmlEscape( text ) + "</span>" : "";
	}

	// Counts down the time left on running valves, between status refreshes
	function updateTimes() {
		pinLayer.find( ".site-map-pin-time" ).each( function() {
			var pin = $( this ).closest( ".site-map-pin" ),
				sid = Number( pin.attr( "data-sids" ) ),
				remaining = OSApp.SiteMap.getRemaining( sid ),
				name = OSApp.Stations.getName( sid );

			if ( remaining > 0 ) {
				$( this ).text( OSApp.Dates.sec2hms( remaining ) );
				pin.attr( "title", name + " (" + OSApp.Dates.sec2hms( remaining ) + " " + OSApp.Language._( "remaining" ) + ")" );
			} else {
				$( this ).text( "" );
				pin.attr( "title", name );
			}
		} );
	}

	function svgElement( tag, attributes ) {
		var element = document.createElementNS( SVG_NS, tag );
		$.each( attributes || {}, function( name, value ) {
			element.setAttribute( name, value );
		} );
		return element;
	}

	// The points a run's line passes through on screen: from its valve (hasFeed) unless it starts there or is a branch
	function getRunLine( sid, run ) {
		var valve = map.pins[ sid ],
			hasFeed = !!( !run.branch && valve && run.pts.length && ( run.pts[ 0 ][ 0 ] !== valve.x || run.pts[ 0 ][ 1 ] !== valve.y ) );

		return {
			hasFeed: hasFeed,
			points: ( hasFeed ? [ [ valve.x, valve.y ] ] : [] ).concat( run.pts ).map( function( pt ) {
				var screen = toScreen( { x: pt[ 0 ], y: pt[ 1 ] } );
				return { x: screen.left, y: screen.top };
			} )
		};
	}

	// The map point on a run's line (including its pipe from the valve) closest to pos
	function nearestOnRun( sid, run, pos ) {
		var size = getSize(),
			screen = toScreen( pos ),
			line = getRunLine( sid, run ),
			nearest = line.points.length > 1 ?
				OSApp.SiteMap.nearestOnCurve( OSApp.SiteMap.getCurve( line.points ), { x: screen.left, y: screen.top } ) :
				line.points[ 0 ];

		return {
			x: Math.min( 1, Math.max( 0, ( nearest.x - view.x ) / ( size.width * view.scale ) ) ),
			y: Math.min( 1, Math.max( 0, ( nearest.y - view.y ) / ( size.height * view.scale ) ) )
		};
	}

	// SVG path data for segments from OSApp.SiteMap.getCurve
	function curvePath( segments ) {
		var coords = function( pt ) {
			return pt.x.toFixed( 1 ) + " " + pt.y.toFixed( 1 );
		};

		return "M" + coords( segments[ 0 ].from ) + segments.map( function( segment ) {
			return "C" + coords( segment.c1 ) + " " + coords( segment.c2 ) + " " + coords( segment.to );
		} ).join( "" );
	}

	// Head runs and drip lines, drawn in screen pixels so symbols and strokes keep their size when zoomed
	function renderDrawings( stationCount ) {
		var layer = drawLayer[ 0 ],
			anyRunning = false,
			showHandles = editing;

		while ( layer.firstChild ) {
			layer.removeChild( layer.firstChild );
		}
		layer.setAttribute( "width", container.width() );
		layer.setAttribute( "height", container.height() );

		// Everything is drawn into one group, so a pan or zoom can move it with a transform (see repositionLayers)
		drawRoot = svgElement( "g", { "class": "site-map-drawings-root" } );
		layer.appendChild( drawRoot );
		renderedView = { scale: view.scale, x: view.x, y: view.y };
		container.toggleClass( "site-map-drawing", !!drawing );

		$.each( map.drawings, function( sid ) {
			if ( Number( sid ) < stationCount && OSApp.SiteMap.getPinState( Number( sid ) ) === "running" ) {
				anyRunning = true;
			}
		} );

		$.each( map.drawings, function( sid, runs ) {
			sid = Number( sid );
			if ( sid >= stationCount || !OSApp.SiteMap.isStationShown( sid ) ) {
				return;
			}
			var state = OSApp.SiteMap.getPinState( sid ),
				name = OSApp.Stations.getName( sid );

			runs.forEach( function( run, runIndex ) {
				var current = drawing && drawing.run === run,
					line = getRunLine( sid, run ),

					// The pipe from the valve is the first piece of the same curve, so it bends smoothly into the run
					curve = OSApp.SiteMap.getCurve( line.points ),
					feed = line.hasFeed ? curve.shift() : null,
					group = svgElement( "g", {
						"class": "site-map-run site-map-run-" + run.type + " site-map-run-" + state +
							( anyRunning && state !== "running" ? " site-map-run-dim" : "" ) + ( current ? " site-map-run-current" : "" ),
						"data-sid": sid,
						"data-run": runIndex
					} ),
					title = svgElement( "title" );

				title.textContent = name;
				group.appendChild( title );

				// Supply pipe from the valve to the run's first point
				if ( feed ) {
					group.appendChild( svgElement( "path", { "class": "site-map-run-hit", d: curvePath( [ feed ] ) } ) );
					group.appendChild( svgElement( "path", { "class": "site-map-run-feed", d: curvePath( [ feed ] ) } ) );
				}
				if ( curve.length ) {
					group.appendChild( svgElement( "path", { "class": "site-map-run-hit", d: curvePath( curve ) } ) );
					group.appendChild( svgElement( "path", { "class": "site-map-run-line", d: curvePath( curve ) } ) );
				}

				run.pts.forEach( function( pt, pointIndex ) {
					var screen = toScreen( { x: pt[ 0 ], y: pt[ 1 ] } );

					// A branch starts with a junction on the run it comes off, not a head
					if ( run.branch && pointIndex === 0 ) {
						group.appendChild( svgElement( "circle", { "class": "site-map-junction", cx: screen.left, cy: screen.top, r: 3 } ) );
					} else if ( run.type === "heads" ) {
						group.appendChild( svgElement( "circle", { "class": "site-map-head", cx: screen.left, cy: screen.top, r: 5 } ) );
						group.appendChild( svgElement( "path", {
							"class": "site-map-head-mark",
							d: "M" + ( screen.left - 3 ) + " " + screen.top + "h6M" + screen.left + " " + ( screen.top - 3 ) + "v6"
						} ) );
					}
					if ( showHandles && ( !drawing || current ) ) {
						group.appendChild( svgElement( "circle", {
							"class": "site-map-handle", cx: screen.left, cy: screen.top, r: 8, "data-point": pointIndex
						} ) );
					}
				} );
				drawRoot.appendChild( group );
			} );
		} );
	}

	// While the view is moving, move what is already drawn instead of rebuilding it: valves are repositioned
	// and the drawings shifted and scaled as one piece. Groups of valves are recomputed once the view settles.
	function repositionLayers() {
		var size = getSize(),
			width = size.width * view.scale,
			height = size.height * view.scale,
			ratio;

		// Size is read once, not per valve, to avoid a layout pass for each one
		pinLayer.children( ".site-map-pin" ).each( function() {
			this.style.left = ( view.x + Number( this.getAttribute( "data-x" ) ) * width ) + "px";
			this.style.top = ( view.y + Number( this.getAttribute( "data-y" ) ) * height ) + "px";
		} );
		if ( drawRoot && renderedView ) {
			ratio = view.scale / renderedView.scale;
			drawRoot.setAttribute( "transform", "translate(" + ( view.x - ratio * renderedView.x ) + " " + ( view.y - ratio * renderedView.y ) +
				") scale(" + ratio + ")" );
		}
	}

	function updatePinStates() {
		if ( !drag ) {
			renderPins();
		}
	}

	function onDataRefresh() {
		updatePinStates();
		checkForRemoteChanges();
	}

	function onResize() {
		fitMap();
		if ( atHome ) {
			resetView();
			return;
		}

		var size = getSize(),
			ratio = lastWidth ? size.width / lastWidth : 1;

		// Keep the same part of the map in view when the layout width changes
		setView( { scale: view.scale, x: view.x * ratio, y: view.y * ratio } );
	}

	function getSids( pin ) {
		return pin.attr( "data-sids" ).split( "," ).map( Number );
	}

	// Zoom in just far enough to separate every pin in a group, centered on the group.
	// Pins too close to separate even at maximum zoom are listed instead.
	function openGroup( pin ) {
		var sids = getSids( pin ),
			size = getSize(),
			pins = {},
			scale, xs, ys;

		sids.forEach( function( sid ) {
			pins[ sid ] = map.pins[ sid ];
		} );
		scale = OSApp.SiteMap.getSeparatingScale( pins, size.width, size.height, Constants.clusterRadius, getMaxZoom() );

		if ( scale === null ) {
			showGroupList( sids );
			return;
		}

		xs = sids.map( function( sid ) {
			return pins[ sid ].x;
		} );
		ys = sids.map( function( sid ) {
			return pins[ sid ].y;
		} );
		zoomTo( {
			x: ( Math.min.apply( null, xs ) + Math.max.apply( null, xs ) ) / 2,
			y: ( Math.min.apply( null, ys ) + Math.max.apply( null, ys ) ) / 2
		}, Math.max( scale, view.scale ), true );
	}

	// Lists every station in a group so one can be picked even when the pins overlap
	function showGroupList( sids ) {
		var list = sids.map( function( sid ) {
				var name = OSApp.Utils.htmlEscape( OSApp.Stations.getName( sid ) ),
					state = "<span class='site-map-state-dot site-map-pin-" + OSApp.SiteMap.getPinState( sid ) + "'></span>";

				return "<li><a href='#' data-sid='" + sid + "' data-action='" + ( editing ? "edit" : "control" ) + "'>" +
					state + name + "</a></li>";
			} ).join( "" ),
			popup = $( "<div data-role='popup' data-theme='a' class='site-map-picker'>" +
				"<ul data-role='listview' data-inset='true' data-corners='false'>" +
					"<li data-role='list-divider'>" + OSApp.Language._( "Stations" ) + "</li>" +
					list +
				"</ul>" +
			"</div>" );

		popup.on( "click", "a[data-sid]", function() {
			var sid = parseInt( $( this ).attr( "data-sid" ), 10 ),
				action = $( this ).attr( "data-action" );

			// Wait for the list to close before opening any follow-up dialog
			popup.one( "popupafterclose", function() {
				if ( action === "edit" ) {
					showStationActions( sid );
				} else {
					controlStation( sid );
				}
			} );
			popup.popup( "close" );
			return false;
		} );

		OSApp.UIDom.openPopup( popup );
	}

	// Shows a list of actions; each item is { label, icon, action }
	function showActions( title, items ) {
		var popup = $( "<div data-role='popup' data-theme='a' class='site-map-picker'>" +
			"<ul data-role='listview' data-inset='true' data-corners='false'>" +
				"<li data-role='list-divider'></li>" +
				items.map( function( item, index ) {
					return "<li data-icon='" + item.icon + "'><a href='#' data-index='" + index + "'>" + OSApp.Utils.htmlEscape( item.label ) + "</a></li>";
				} ).join( "" ) +
			"</ul>" +
		"</div>" );

		popup.find( "li[data-role='list-divider']" ).text( title );
		popup.on( "click", "a[data-index]", function() {
			var item = items[ Number( $( this ).attr( "data-index" ) ) ];
			popup.one( "popupafterclose", item.action );
			popup.popup( "close" );
			return false;
		} );
		OSApp.UIDom.openPopup( popup );
	}

	function showStationActions( sid ) {
		showActions( OSApp.Stations.getName( sid ), [
			{ label: OSApp.Language._( "Add heads" ), icon: "plus", action: function() {
				startDrawing( sid, "heads" );
			} },
			{ label: OSApp.Language._( "Add drip line" ), icon: "plus", action: function() {
				startDrawing( sid, "drip" );
			} },
			{ label: OSApp.Language._( "Move valve" ), icon: "location", action: function() {
				placingSid = sid;
				updateHint();
			} },
			{ label: OSApp.Language._( "Delete" ), icon: "delete", action: function() {
				removePin( sid );
			} }
		] );
	}

	// at is the map point that was tapped, where a branch can start; pointIndex is set when a point's handle was
	// tapped, and then Delete removes just that point
	function showRunActions( sid, runIndex, at, pointIndex ) {
		var run = map.drawings[ sid ][ runIndex ],
			min = OSApp.SiteMap.getMinPoints( run ),
			items = [
				{ label: OSApp.Language._( "Add" ), icon: "plus", action: function() {
					startDrawing( sid, run.type, run );
				} }
			],
			branch = function( type ) {
				return function() {
					startDrawing( sid, type, null, nearestOnRun( sid, run, at ) );
				};
			};

		if ( at ) {
			items.push(
				{ label: OSApp.Language._( "Add heads" ), icon: "plus", action: branch( "heads" ) },
				{ label: OSApp.Language._( "Add drip line" ), icon: "plus", action: branch( "drip" ) }
			);
		}

		if ( run.pts.length > min ) {
			items.push( { label: OSApp.Language._( "Undo point" ), icon: "back", action: function() {
				run.pts.pop();
				persist( [ "drawings" ] );
				renderPins();
			} } );
		}
		items.push( { label: OSApp.Language._( "Delete" ), icon: "delete", action: function() {
				if ( pointIndex === undefined || !removePoint( run, pointIndex ) ) {
					removeRun( sid, run );
				}
				persist( [ "drawings" ] );
				renderPins();
			} } );
		showActions( OSApp.Stations.getName( sid ), items );
	}

	// Removes one point of a run, unless that would leave it too short to keep or it is where a branch joins;
	// returns whether it did
	function removePoint( run, pointIndex ) {
		if ( ( run.branch && pointIndex === 0 ) || run.pts.length <= OSApp.SiteMap.getMinPoints( run ) ) {
			return false;
		}
		run.pts.splice( pointIndex, 1 );
		return true;
	}

	function removeRun( sid, run ) {
		var runs = map.drawings[ sid ] || [];
		runs.splice( runs.indexOf( run ), 1 );
		if ( !runs.length ) {
			delete map.drawings[ sid ];
		}
	}

	// Draws a new run for a station, or adds points to an existing one. A new run starting at junction (a map point
	// on another run) is a branch of it.
	function startDrawing( sid, type, run, junction ) {
		var isNew = !run;

		if ( isNew ) {
			run = junction ? { type: type, branch: true, pts: [ [ junction.x, junction.y ] ] } : { type: type, pts: [] };
			( map.drawings[ sid ] = map.drawings[ sid ] || [] ).push( run );
		}

		// keep: points Undo can't take away, the ones the run had before, or a branch's junction
		drawing = { sid: sid, run: run, isNew: isNew, keep: run.pts.length, original: run.pts.map( function( pt ) {
			return pt.slice();
		} ) };
		drawbar.find( ".site-map-drawbar-label" ).text(
			( type === "heads" ? OSApp.Language._( "Add heads" ) : OSApp.Language._( "Add drip line" ) ) + ": " + OSApp.Stations.getName( sid ) );
		page.addClass( "site-map-drawing-mode" );
		renderPins();
	}

	// Keeps the run if it has enough points, otherwise discards it
	function finishDrawing() {
		var current = drawing;

		drawing = null;
		page.removeClass( "site-map-drawing-mode" );

		if ( current.run.pts.length < OSApp.SiteMap.getMinPoints( current.run ) ) {
			if ( current.isNew ) {
				removeRun( current.sid, current.run );
			} else {
				current.run.pts = current.original;
			}
		}
		persist( [ "drawings" ] );
		renderPins();
	}

	function cancelDrawing() {
		var current = drawing;

		drawing = null;
		page.removeClass( "site-map-drawing-mode" );
		if ( current.isNew ) {
			removeRun( current.sid, current.run );
		} else {
			current.run.pts = current.original;
		}
		renderPins();
	}

	// Adds a point to the run being drawn. The first point of a new run snaps to its valve when tapped near it,
	// and a new drip line always starts at its valve, so it is dashed from there rather than fed by a pipe.
	function addDrawingPoint( event ) {
		var pos = getRelativePosition( event ),
			valve = map.pins[ drawing.sid ],
			screen, valveScreen;

		if ( valve && drawing.isNew && !drawing.run.pts.length ) {
			screen = toScreen( pos );
			valveScreen = toScreen( valve );
			if ( Math.hypot( screen.left - valveScreen.left, screen.top - valveScreen.top ) <= Constants.snapRadius ) {
				pos = { x: valve.x, y: valve.y };
			} else if ( drawing.run.type === "drip" ) {
				drawing.run.pts.push( [ valve.x, valve.y ] );
			}
		}
		drawing.run.pts.push( [ pos.x, pos.y ] );
		renderPins();
	}

	function choosePicture() {
		var onController = source === "controller";

		OSApp.UIDom.getPicture( function( data ) {
			var previous = map.image,
				dataURL = "data:image/jpeg;base64," + data,
				showImage = function() {
					image.attr( "src", map.image || "" );

					// Go straight to placing stations on a newly added map
					setEditing( !previous && !!map.image );
					fitMap();
				},
				showProgress = showUploadProgress;

			// A new image while editing is part of the edit: saved with Done, undone by Cancel
			if ( editing ) {
				map.image = dataURL;
				dirty.image = true;
				image.attr( "src", map.image );
				fitMap();
				return;
			}

			if ( !onController ) {
				map.image = dataURL;
				if ( !OSApp.SiteMap.save( siteName, map ) ) {
					map.image = previous;
				}
				showImage();
				return;
			}

			showProgress( 0 );
			track( OSApp.SiteMap.uploadImage( dataURL, showProgress ).then( function() {
				map.image = dataURL;

				// Learn the revision the upload produced before editing starts, so saving the edit doesn't
				// mistake this upload for a change made on another device
				return refreshRevision();
			} ).then( showImage ).always( function() {
				$.mobile.loading( "hide" );
			} ) );
		}, onController ? Constants.controllerImageSize : Constants.maxImageSize,
		onController ? Constants.controllerImageQuality : Constants.imageQuality );
	}

	function clearMap() {
		OSApp.UIDom.areYouSure( OSApp.Language._( "Are you sure you want to clear the site map?" ), "", function() {
				var clearLocal = function() {
					clearTimeout( pinSaveTimer );
					pinSaveTimer = null;
					map = { pins: {}, drawings: {} };
					dirty = { pins: false, drawings: false, image: false };
					editSnapshot = null;
					OSApp.Storage.remove( OSApp.SiteMap.getStorageKey( siteName ) );
					image.attr( "src", "" );
					setEditing( false );
					fitMap();
					resetView();
				};

				if ( source !== "controller" ) {
					clearLocal();
					return;
				}
				track( OSApp.SiteMap.deleteRemote().then( function() {
					clearLocal();
					return refreshRevision();
				} ) );
			} );
	}

	function showStationPicker( pos ) {
		var names = getStationNames(),
			list = "",
			sid, popup;

		for ( sid = 0; sid < names.length; sid++ ) {
			if ( Object.prototype.hasOwnProperty.call( map.pins, sid ) || !OSApp.SiteMap.isStationShown( sid ) ) {
				continue;
			}
			list += "<li><a href='#' data-sid='" + sid + "'>" + OSApp.Utils.htmlEscape( OSApp.Stations.getName( sid ) ) +
				kindBadge( sid, "site-map-picker-badge" ) + "</a></li>";
		}

		if ( list === "" ) {
			OSApp.Errors.showError( OSApp.Language._( "All stations have already been placed on the map." ) );
			return;
		}

		popup = $( "<div data-role='popup' data-theme='a' class='site-map-picker'>" +
			"<ul data-role='listview' data-inset='true' data-corners='false'>" +
				"<li data-role='list-divider'>" + OSApp.Language._( "Stations" ) + "</li>" +
				list +
			"</ul>" +
		"</div>" );

		popup.on( "click", "a[data-sid]", function() {
			map.pins[ $( this ).attr( "data-sid" ) ] = pos;
			persist();
			renderPins();
			popup.popup( "close" );
			return false;
		} );

		OSApp.UIDom.openPopup( popup );
	}

	// Removes a valve and everything drawn for it
	function removePin( sid ) {
		var hasDrawings = !!( map.drawings[ sid ] || [] ).length;

		OSApp.UIDom.areYouSure( OSApp.Language._( "Are you sure you want to delete " ) +
			OSApp.Utils.htmlEscape( OSApp.Stations.getName( sid ) ) + "?", "", function() {
			delete map.pins[ sid ];
			delete map.drawings[ sid ];
			persist( hasDrawings ? [ "pins", "drawings" ] : [ "pins" ] );
			renderPins();
		} );
	}

	// Mirrors the station card behavior on the home page: stop a running station or start a manual run
	function controlStation( sid ) {
		var name = OSApp.Stations.getName( sid );

		if ( !OSApp.Firmware.checkOSVersion( 210 ) || OSApp.Stations.isMaster( sid ) || OSApp.Stations.isDisabled( sid ) ||
			OSApp.Bundles.isDerivedOnly( sid ) ) {
			OSApp.Errors.showError( OSApp.Language._( "Operation not permitted." ) );
			return;
		}

		if ( OSApp.Stations.getStatus( sid ) || OSApp.Stations.getPID( sid ) ) {
			OSApp.UIDom.areYouSure( OSApp.Language._( "Do you want to stop the selected station?" ), OSApp.Utils.htmlEscape( name ), function() {
				OSApp.Firmware.sendToOS( "/cm?sid=" + sid + "&en=0&pw=" ).done( function() {
					OSApp.Stations.setPID( sid, 0 );
					OSApp.Stations.setRemainingRuntime( sid, 0 );
					OSApp.Stations.setStatus( sid, 0 );
					delete OSApp.uiState.timers[ "station-" + sid ];
					updatePinStates();
					OSApp.Status.refreshStatus();
					OSApp.Errors.showError( OSApp.Language._( "Station has been stopped" ) );
				} );
			} );
			return;
		}

		OSApp.UIDom.showDurationBox( {
			title: name,
			maximum: 64800,
			helptext: OSApp.Language._( "Enter a duration to manually run " ) + name,
			callback: function( duration ) {
				OSApp.Firmware.sendToOS( "/cm?sid=" + sid + "&en=1&t=" + duration + "&pw=", "json" ).done( function() {
					OSApp.Stations.setPID( sid, OSApp.Constants.options.MANUAL_STATION_PID );
					OSApp.Stations.setRemainingRuntime( sid, duration );
					updatePinStates();
					OSApp.Status.refreshStatus();
					OSApp.Errors.showError( OSApp.Language._( "Station has been queued" ) );
				} );
			}
		} );
	}

	function onMapTap( event, runTarget ) {
		if ( drawing ) {
			addDrawingPoint( event );
			return;
		}
		if ( runTarget ) {
			if ( editing ) {
				showRunActions( runTarget.sid, runTarget.run, getRelativePosition( event ) );
			} else {
				controlStation( runTarget.sid );
			}
			return;
		}
		if ( !editing ) {
			return;
		}
		if ( placingSid !== null ) {
			map.pins[ placingSid ] = getRelativePosition( event );
			placingSid = null;
			persist();
			renderPins();
			return;
		}
		showStationPicker( getRelativePosition( event ) );
	}

	// jQuery 2 doesn't copy pointer properties such as pointerId onto its events, so read them from the native event
	function nativeEvent( event ) {
		return event.originalEvent || event;
	}

	// Taps are acted on at pointerup, but after a touch the browser also fires a click at the same spot a moment
	// later. That click would land on whatever the tap just opened, such as an item in a station list, so drop it.
	function ignoreFollowingClick( event ) {
		var timer,
			swallow = function( click ) {
				click.preventDefault();
				click.stopPropagation();
				stop();
			},
			stop = function() {
				clearTimeout( timer );
				document.removeEventListener( "click", swallow, true );
			};

		if ( nativeEvent( event ).pointerType === "mouse" ) {
			return;
		}
		document.addEventListener( "click", swallow, true );
		timer = setTimeout( stop, 500 );
	}

	function capturePointer( element, event ) {
		try {
			element.setPointerCapture( nativeEvent( event ).pointerId );
		} catch {

			// The pointer was already released
		}
	}

	// Pins: tap or click to act, drag to move while editing
	container.on( "pointerdown", ".site-map-pin", function( event ) {
		var pin = $( this ),
			e = nativeEvent( event ),
			rect = container[ 0 ].getBoundingClientRect();

		// Remember where the pin's tip is relative to the pointer so it doesn't jump when dragged
		drag = {
			pin: pin,
			sids: getSids( pin ),
			startX: e.clientX,
			startY: e.clientY,
			offsetX: e.clientX - rect.left - parseFloat( pin.css( "left" ) ),
			offsetY: e.clientY - rect.top - parseFloat( pin.css( "top" ) ),
			moved: false
		};

		// Capture so the release always reaches the pin, even if the pointer slides off it
		capturePointer( this, event );
		event.preventDefault();
		event.stopPropagation();
	} );

	container.on( "pointermove", ".site-map-pin", function( event ) {
		var e = nativeEvent( event ),
			pos, screen;

		// Groups aren't dragged; zoom in to separate them first
		if ( !drag || !editing || drag.sids.length > 1 ) {
			return;
		}
		event.stopPropagation();
		if ( !drag.moved && Math.hypot( e.clientX - drag.startX, e.clientY - drag.startY ) < Constants.dragThreshold ) {
			return;
		}
		drag.moved = true;
		pos = getRelativePosition( event, drag.offsetX, drag.offsetY );
		screen = toScreen( pos );
		drag.pin.css( { left: screen.left + "px", top: screen.top + "px" } );
		map.pins[ drag.sids[ 0 ] ] = pos;
	} );

	container.on( "pointerup pointercancel", ".site-map-pin", function( event ) {
		var current = drag;
		drag = null;
		if ( !current ) {
			return;
		}
		event.stopPropagation();
		if ( current.moved ) {
			persist();

			// The pin may now overlap others, or have left a group
			renderPins();
		} else if ( event.type === "pointerup" ) {
			ignoreFollowingClick( event );
			if ( current.sids.length > 1 ) {
				openGroup( current.pin );
			} else if ( editing ) {
				showStationActions( current.sids[ 0 ] );
			} else {
				controlStation( current.sids[ 0 ] );
			}
		}
	} );

	// Run points: drag to move them while editing; a tap opens the run's actions
	container.on( "pointerdown", ".site-map-handle", function( event ) {
		var e = nativeEvent( event ),
			group = $( this ).closest( ".site-map-run" );

		if ( e.pointerType === "mouse" && e.button !== 0 ) {
			return;
		}
		handleDrag = {
			sid: Number( group.attr( "data-sid" ) ),
			runIndex: Number( group.attr( "data-run" ) ),
			pointIndex: Number( this.getAttribute( "data-point" ) ),
			startX: e.clientX,
			startY: e.clientY,
			moved: false
		};

		// The handle is redrawn while dragging, so the container keeps the pointer
		capturePointer( container[ 0 ], event );
		event.preventDefault();
	} );

	// Map background: drag with a mouse or one finger to pan, pinch to zoom, tap to place a station while editing
	container.on( "pointerdown", function( event ) {
		var e = nativeEvent( event ),
			run = $( event.target ).closest( ".site-map-run" );

		if ( handleDrag || $( event.target ).closest( ".site-map-pin, .site-map-controls, .site-map-empty-prompt, .site-map-drawbar" ).length ||
			( e.pointerType === "mouse" && e.button !== 0 ) ) {
			return;
		}
		pointers[ e.pointerId ] = { x: e.clientX, y: e.clientY };
		capturePointer( this, event );
		if ( Object.keys( pointers ).length === 1 ) {
			gesture = {
				startX: e.clientX,
				startY: e.clientY,
				moved: false,

				// A tap on a drawn run acts on its station; a drag starting on one still pans
				run: run.length ? { sid: Number( run.attr( "data-sid" ) ), run: Number( run.attr( "data-run" ) ) } : null
			};
		} else if ( gesture ) {
			gesture.moved = true;
		}
	} );

	container.on( "pointermove", function( event ) {
		var e = nativeEvent( event ),
			run, pos;

		if ( handleDrag ) {
			if ( !handleDrag.moved && Math.hypot( e.clientX - handleDrag.startX, e.clientY - handleDrag.startY ) < Constants.dragThreshold ) {
				return;
			}
			handleDrag.moved = true;
			run = map.drawings[ handleDrag.sid ][ handleDrag.runIndex ];
			pos = getRelativePosition( event );
			run.pts[ handleDrag.pointIndex ] = [ pos.x, pos.y ];
			renderPins();
		}
	} );

	container.on( "pointerup pointercancel", function( event ) {
		var current = handleDrag;

		if ( !current ) {
			return;
		}
		handleDrag = null;
		if ( current.moved ) {
			persist( [ "drawings" ] );
		} else if ( event.type === "pointerup" && !drawing ) {
			ignoreFollowingClick( event );
			var point = map.drawings[ current.sid ][ current.runIndex ].pts[ current.pointIndex ];
			showRunActions( current.sid, current.runIndex, { x: point[ 0 ], y: point[ 1 ] }, current.pointIndex );
		}
	} );

	container.on( "pointermove", function( event ) {
		var e = nativeEvent( event ),
			previous = pointers[ e.pointerId ],
			current = { x: e.clientX, y: e.clientY },
			ids = Object.keys( pointers ),
			rect, other, oldDistance, oldMid, next, size;

		if ( !previous || !gesture ) {
			return;
		}

		if ( ids.length >= 2 ) {
			other = pointers[ ids.find( function( id ) {
				return Number( id ) !== e.pointerId;
			} ) ];
			oldDistance = Math.hypot( previous.x - other.x, previous.y - other.y );
			oldMid = { x: ( previous.x + other.x ) / 2, y: ( previous.y + other.y ) / 2 };
			rect = container[ 0 ].getBoundingClientRect();
			size = getSize();

			if ( oldDistance > 0 ) {
				next = OSApp.SiteMap.zoomAt( view, Math.hypot( current.x - other.x, current.y - other.y ) / oldDistance,
					oldMid.x - rect.left, oldMid.y - rect.top, size.width, size.height, getMaxZoom(), getViewport() );

				// Pan with the midpoint so the map follows both fingers
				next.x += ( current.x + other.x ) / 2 - oldMid.x;
				next.y += ( current.y + other.y ) / 2 - oldMid.y;
				setView( next, false, true );
			}
			pointers[ e.pointerId ] = current;
			return;
		}

		if ( !gesture.moved && Math.hypot( current.x - gesture.startX, current.y - gesture.startY ) < Constants.dragThreshold ) {
			return;
		}
		gesture.moved = true;
		container.addClass( "site-map-panning" );
		setView( { scale: view.scale, x: view.x + current.x - previous.x, y: view.y + current.y - previous.y }, false, true );
		pointers[ e.pointerId ] = current;
	} );

	container.on( "pointerup pointercancel", function( event ) {
		var e = nativeEvent( event ),
			current = gesture;

		if ( !pointers[ e.pointerId ] ) {
			return;
		}
		delete pointers[ e.pointerId ];
		if ( Object.keys( pointers ).length ) {
			return;
		}
		gesture = null;
		container.removeClass( "site-map-panning" );
		if ( event.type === "pointerup" && current && !current.moved ) {
			ignoreFollowingClick( event );
			onMapTap( event, current.run );
		}
	} );

	// Swiping sideways on the map pans it, so don't let the swipe also open the side menu or notifications
	container.on( "swiperight swipeleft", function( event ) {
		event.stopImmediatePropagation();
	} );

	// Double-click or double-tap zooms in; skipped while editing, where a click places a station
	container.on( "dblclick", function( event ) {
		var e = nativeEvent( event ),
			rect = container[ 0 ].getBoundingClientRect();

		if ( editing || $( event.target ).closest( ".site-map-pin, .site-map-controls, .site-map-empty-prompt" ).length ) {
			return;
		}
		zoomBy( e.shiftKey ? 1 / Constants.zoomStep : Constants.zoomStep, e.clientX - rect.left, e.clientY - rect.top, true );
		return false;
	} );

	// Mouse wheel zooms around the cursor; trackpad pinches arrive as wheel events with ctrlKey set
	container[ 0 ].addEventListener( "wheel", function( event ) {
		var rect = container[ 0 ].getBoundingClientRect(),
			delta = event.deltaY * ( event.deltaMode === 1 ? 33 : 1 );

		// Let the page scroll when the map can't zoom out any further
		if ( delta > 0 && view.scale <= getViewport().minScale ) {
			return;
		}
		event.preventDefault();
		zoomBy( Math.pow( 2, -delta / ( event.ctrlKey ? 100 : 300 ) ), event.clientX - rect.left, event.clientY - rect.top, false, true );
	}, { passive: false } );

	// Safari reports trackpad pinches as gesture events instead of wheel events
	container[ 0 ].addEventListener( "gesturestart", function( event ) {
		event.preventDefault();
		gestureScale = view.scale;
	} );

	container[ 0 ].addEventListener( "gesturechange", function( event ) {
		var rect = container[ 0 ].getBoundingClientRect();

		event.preventDefault();

		// Touch pinches on iOS also send pointer events, which are already handled
		if ( Object.keys( pointers ).length ) {
			return;
		}
		zoomBy( gestureScale * event.scale / view.scale, event.clientX - rect.left, event.clientY - rect.top, false, true );
	} );

	// Keyboard: + and - zoom, 0 resets, arrow keys pan
	function onKeydown( event ) {
		var e = nativeEvent( event ),
			tag = event.target && event.target.tagName,
			size = getSize(),
			step = 0.1;

		if ( tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.altKey || e.ctrlKey || e.metaKey ||
			!map.image || $( ".ui-popup-active" ).length ) {
			return;
		}

		switch ( e.key ) {
			case "+":
			case "=":
				zoomBy( Constants.zoomStep, undefined, undefined, true );
				break;
			case "-":
			case "_":
				zoomBy( 1 / Constants.zoomStep, undefined, undefined, true );
				break;
			case "0":
				resetView( true );
				break;
			case "ArrowLeft":
				setView( { scale: view.scale, x: view.x + size.width * step, y: view.y } );
				break;
			case "ArrowRight":
				setView( { scale: view.scale, x: view.x - size.width * step, y: view.y } );
				break;
			case "ArrowUp":
				setView( { scale: view.scale, x: view.x, y: view.y + size.height * step } );
				break;
			case "ArrowDown":
				setView( { scale: view.scale, x: view.x, y: view.y - size.height * step } );
				break;
			default:
				return;
		}

		// Arrow keys only take over from page scrolling while zoomed in
		if ( canPan() || e.key.indexOf( "Arrow" ) !== 0 ) {
			event.preventDefault();
		}
	}

	container.find( ".site-map-zoom-in" ).on( "click", function() {
		zoomBy( Constants.zoomStep, undefined, undefined, true );
		return false;
	} );

	container.find( ".site-map-zoom-out" ).on( "click", function() {
		zoomBy( 1 / Constants.zoomStep, undefined, undefined, true );
		return false;
	} );

	container.find( ".site-map-zoom-reset" ).on( "click", function() {
		resetView( true );
		return false;
	} );

	// Pin positions depend on the rendered size of the map
	image.on( "load", function() {
		fitMap();
		resetView();
	} );

	drawbar.find( ".site-map-draw-undo" ).on( "click", function() {
		if ( drawing && drawing.run.pts.length > drawing.keep ) {
			drawing.run.pts.pop();
			renderPins();
		}
		return false;
	} );

	drawbar.find( ".site-map-draw-done" ).on( "click", function() {
		if ( drawing ) {
			finishDrawing();
		}
		return false;
	} );

	drawbar.find( ".site-map-draw-cancel" ).on( "click", function() {
		if ( drawing ) {
			cancelDrawing();
		}
		return false;
	} );

	page.find( ".site-map-edit" ).on( "click", function() {
		setEditing( !editing );
		return false;
	} );

	page.find( ".site-map-cancel" ).on( "click", function() {
		if ( editing ) {
			setEditing( false, true );
		}
		return false;
	} );

	page.find( ".site-map-image, .site-map-add-image" ).on( "click", function() {
		choosePicture();
		return false;
	} );

	page.find( ".site-map-clear" ).on( "click", function() {
		clearMap();
		return false;
	} );

	var active = false,
		mapLoaded = false,
		layoutObserver = null;

	function deactivate() {
		if ( !active ) {
			return;
		}
		active = false;

		// Leaving without tapping Done discards the edit
		if ( editing ) {
			setEditing( false, true );
		}

		// Forget any gesture or animation in progress; its pointer events won't arrive while hidden
		stopAnimation();
		pointers = {};
		gesture = null;
		drag = null;
		handleDrag = null;
		container.removeClass( "site-map-panning" );

		// Send any changes still waiting to be saved
		if ( pinSaveTimer ) {
			uploadChanges();
		}
		$( "html" ).off( "datarefresh.sitemap showdisabled.sitemap" );
		$( window ).off( "resize.sitemap" );
		$( document ).off( "keydown.sitemap" );
		clearInterval( timeTimer );
		timeTimer = null;
		clearTimeout( settleTimer );
		settleTimer = null;
		if ( layoutObserver ) {
			layoutObserver.disconnect();
			layoutObserver = null;
		}
	}

	function activate() {
		if ( active ) {
			return;
		}
		active = true;
		$( "html" ).off( "datarefresh.sitemap" ).on( "datarefresh.sitemap", onDataRefresh )
			.off( "showdisabled.sitemap" ).on( "showdisabled.sitemap", updatePinStates );
		$( window ).off( "resize.sitemap" ).on( "resize.sitemap", onResize );
		$( document ).off( "keydown.sitemap" ).on( "keydown.sitemap", onKeydown );
		clearInterval( timeTimer );
		timeTimer = setInterval( updateTimes, 1000 );
		watchLayoutAbove();
		fitMap();
		if ( atHome ) {
			resetView();
		} else {
			setView( view );
		}

		updateHint();
		OSApp.Storage.get( "current_site", function( data ) {
			siteName = data.current_site || "default";

			// Show this device's copy straight away while the controller's version loads
			if ( !mapLoaded ) {
				OSApp.SiteMap.load( siteName, function( cached ) {
					if ( active && !mapLoaded && OSApp.SiteMap.hasData( cached ) ) {
						showMap( cached, source );
					}
				} );
			}
			OSApp.SiteMap.loadMap( siteName, function( loaded, loadedSource ) {
				if ( !active ) {
					return;
				}
				mapLoaded = true;
				showMap( loaded, loadedSource );
				setEditing( false );
			} );
		} );
	}

	return { root: page, activate: activate, deactivate: deactivate };
};
