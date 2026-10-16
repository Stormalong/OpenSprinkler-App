/* eslint-disable */

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

// Shows the site map view on the home page, freshly loaded, and resolves with its root element
function openHomeMap() {
	var ready = $(".ui-page-active").attr("id") === "sprinklers" ? Promise.resolve() : new Promise(function (resolve) {
		$.mobile.document.one("pageshow", "#sprinklers", resolve);
		OSApp.UIDom.changePage("#sprinklers");
	});

	return ready.then(function () {
		OSApp.SiteMap.setHomeView("cards");
		OSApp.SiteMap.setHomeView("map");
		return new Promise(function (resolve) {
			setTimeout(resolve, 50);
		});
	}).then(function () {
		var root = $("#sprinklers .site-map-view"),
			img = root.find(".site-map-image-el")[0];
		if (img.getAttribute("src") && !img.complete) {
			return new Promise(function (resolve) {
				img.addEventListener("load", resolve, { once: true });
			});
		}
	}).then(function () {
		return new Promise(function (resolve) {
			requestAnimationFrame(function () {
				requestAnimationFrame(resolve);
			});
		});
	}).then(function () {
		return $("#sprinklers .site-map-view");
	});
}

describe("Site Map Checks", function () {
	var zoomDuration = OSApp.SiteMap.Constants.zoomDuration;

	// Zooms jump straight to their result in these tests unless a test turns the animation back on
	before(function () {
		OSApp.SiteMap.Constants.zoomDuration = 0;
	});

	after(function () {
		OSApp.SiteMap.Constants.zoomDuration = zoomDuration;
	});

	// 1x1 transparent GIF
	var testImage = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
	var siteName;

	before(function (done) {
		OSApp.currentSession.ip = "demo.opensprinkler.com";
		OSApp.currentSession.pass = "opendoor";
		OSApp.currentSession.prefix = "https://";
		OSApp.currentSession.fw183 = false;

		OSApp.Sites.updateSiteList(["Test"], "Test");

		$.mobile.document.one("pageshow", "#sprinklers", function () {
			OSApp.Storage.get("current_site", function (data) {
				siteName = data.current_site || "default";
				done();
			});
		});

		OSApp.Sites.newLoad();
	});

	afterEach(function () {
		OSApp.Storage.remove(OSApp.SiteMap.getStorageKey(siteName));

		// Back to the station cards, unzoomed, so the next test loads the map afresh
		$("#sprinklers .site-map-zoom-reset").trigger("click");

		// A message from this test, such as "Settings have been saved", could cover the next test's taps
		clearTimeout(OSApp.uiState.errorTimeout);
		$.mobile.loading("hide");
		OSApp.SiteMap.setHomeView("cards");
	});

	// Resolves on the next animation frame, after any queued pin render
	function nextFrame() {
		return new Promise(function (resolve) {
			requestAnimationFrame(function () {
				requestAnimationFrame(resolve);
			});
		});
	}

	// Shows the map on the home page and runs check on it; check may return a promise
	function showSiteMap(done, check) {
		openHomeMap().then(check).then(function () {
			done();
		}, done);
	}

	// Native events, as jQuery 2 doesn't copy pointer properties onto its own event objects
	function pointer(element, type, x, y) {
		$(element)[0].dispatchEvent(new PointerEvent(type, {
			bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0,
			pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true
		}));
	}

	function tap(element) {
		pointer(element, "pointerdown");
		pointer(element, "pointerup");
	}

	it("should save and load map data per site", function (done) {
		var map = { image: testImage, pins: { 0: { x: 0.25, y: 0.75 } }, drawings: { 0: [ { type: "drip", pts: [[0.1, 0.1], [0.2, 0.2]] } ] } };
		OSApp.SiteMap.save(siteName, map);
		OSApp.SiteMap.load(siteName, function (loaded) {
			assert.deepEqual(loaded, JSON.parse(JSON.stringify(map)));
			OSApp.SiteMap.load(siteName + "-other", function (empty) {
				assert.deepEqual(empty, { pins: {}, drawings: {} });
				done();
			});
		});
	});

	it("should recover from corrupt map data", function (done) {
		var data = {};
		data[OSApp.SiteMap.getStorageKey(siteName)] = "{not json";
		OSApp.Storage.set(data);
		OSApp.SiteMap.load(siteName, function (loaded) {
			assert.deepEqual(loaded, { pins: {}, drawings: {} });
			done();
		});
	});

	it("should show the empty state when no image is set", function (done) {
		showSiteMap(done, function (page) {
			// Only the prompt to add an image is shown
			assert.isTrue(page.find(".site-map-container").hasClass("site-map-empty"));
			assert.isTrue(page.find(".site-map-empty-prompt").is(":visible"));
			assert.isTrue(page.find(".site-map-add-image").is(":visible"));
			assert.isFalse(page.find(".site-map-controls").is(":visible"));
			assert.isFalse(page.find(".site-map-hint").is(":visible"));
			assert.lengthOf(page.find(".site-map-pin"), 0);
		});
	});

	it("should fit the map on screen with the image's aspect ratio and the edit button on top", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		showSiteMap(done, function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect(),
				edit = page.find(".site-map-edit")[0].getBoundingClientRect();

			assert.isFalse(container.hasClass("site-map-empty"));

			// The test image is square
			assert.closeTo(rect.width, rect.height, 1);
			assert.isAtMost(rect.bottom, window.innerHeight);

			assert.isAtLeast(edit.top, rect.top);
			assert.isAtMost(edit.bottom, rect.bottom);
		});
	});

	it("should render stored pins at their saved positions", function (done) {
		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: { 0: { x: 0.25, y: 0.75 }, 9999: { x: 0.5, y: 0.5 } }
		});

		showSiteMap(done, function (page) {
			var pins = page.find(".site-map-pin");

			// Pins for stations that do not exist are skipped
			assert.lengthOf(pins, 1);
			assert.equal(pins.attr("data-sids"), "0");
			assert.closeTo(parseFloat(pins[0].style.left), 0.25 * page.find(".site-map-container").width(), 0.5);
			assert.closeTo(parseFloat(pins[0].style.top), 0.75 * page.find(".site-map-container").height(), 0.5);

			// The valve icon is centered on that spot on the map, not inside another element
			var map = page.find(".site-map-container")[0].getBoundingClientRect(),
				pin = pins[0].getBoundingClientRect();
			assert.closeTo(pin.left + pin.width / 2, map.left + 0.25 * map.width, 1);
			assert.closeTo(pin.top + pin.height / 2, map.top + 0.75 * map.height, 1);
			assert.lengthOf(pins.find(".site-map-valve"), 1);
			assert.equal(pins.attr("title"), OSApp.Stations.getName(0));
			assert.equal(pins.text(), "");
			assert.isTrue(pins.is("[class*='site-map-pin-" + OSApp.SiteMap.getPinState(0) + "']"));
		});
	});

	it("should group pins that are close together on screen", function () {
		var clusters = OSApp.SiteMap.clusterPins({
			0: { x: 0.50, y: 0.50 },
			1: { x: 0.52, y: 0.50 },
			2: { x: 0.90, y: 0.10 }
		}, 1000, 1000, 32);

		assert.lengthOf(clusters, 2);
		assert.deepEqual(clusters[0].sids, [0, 1]);
		assert.closeTo(clusters[0].x, 0.51, 1e-9);
		assert.closeTo(clusters[0].y, 0.50, 1e-9);
		assert.deepEqual(clusters[1].sids, [2]);
	});

	it("should separate pins once the map is large enough", function () {
		var pins = { 0: { x: 0.50, y: 0.50 }, 1: { x: 0.52, y: 0.50 } };

		assert.lengthOf(OSApp.SiteMap.clusterPins(pins, 1000, 1000, 32), 1);
		assert.lengthOf(OSApp.SiteMap.clusterPins(pins, 2000, 2000, 32), 2);

		// Without a rendered size nothing is grouped
		assert.lengthOf(OSApp.SiteMap.clusterPins(pins, 0, 0, 32), 2);
	});

	it("should color a group by its most active station", function () {
		var stub = sinon.stub(OSApp.SiteMap, "getPinState").callsFake(function (sid) {
			return ["idle", "running", "disabled"][sid];
		});
		try {
			assert.equal(OSApp.SiteMap.getClusterState([0, 1, 2]), "running");
			assert.equal(OSApp.SiteMap.getClusterState([0, 2]), "idle");
		} finally {
			stub.restore();
		}
	});

	it("should keep the view inside the map when zooming", function () {
		var view = OSApp.SiteMap.zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50, 400, 200, 8);

		// The point under (100, 50) stays put
		assert.deepEqual(view, { scale: 2, x: -100, y: -50 });

		assert.equal(OSApp.SiteMap.zoomAt(view, 100, 0, 0, 400, 200, 8).scale, 8);
		assert.deepEqual(OSApp.SiteMap.zoomAt(view, 0.1, 0, 0, 400, 200, 8), { scale: 1, x: 0, y: 0 });
		assert.deepEqual(OSApp.SiteMap.clampView({ scale: 2, x: 50, y: -500 }, 400, 200, 8), { scale: 2, x: 0, y: -200 });
	});

	it("should find the zoom that separates every pin in a group", function () {
		var pins = { 0: { x: 0.5, y: 0.5 }, 1: { x: 0.51, y: 0.5 }, 2: { x: 0.5, y: 0.505 } },
			scale = OSApp.SiteMap.getSeparatingScale(pins, 1000, 1000, 32, 8);

		// Closest pair is 5px apart at normal size
		assert.isAbove(scale, 32 / 5);
		assert.isAtMost(scale, 8);
		assert.lengthOf(OSApp.SiteMap.clusterPins(pins, 1000 * scale, 1000 * scale, 32), 3);

		assert.equal(OSApp.SiteMap.getSeparatingScale({ 0: { x: 0.1, y: 0.1 }, 1: { x: 0.9, y: 0.9 } }, 1000, 1000, 32, 8), 1);
		assert.isNull(OSApp.SiteMap.getSeparatingScale({ 0: { x: 0.5, y: 0.5 }, 1: { x: 0.5, y: 0.5 } }, 1000, 1000, 32, 8));
		assert.isNull(OSApp.SiteMap.getSeparatingScale({ 0: { x: 0.5, y: 0.5 }, 1: { x: 0.501, y: 0.5 } }, 1000, 1000, 32, 8));
	});

	it("should list stations in a group that can't be separated", function (done) {
		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: { 0: { x: 0.5, y: 0.5 }, 1: { x: 0.5, y: 0.5 }, 2: { x: 0.05, y: 0.05 } }
		});

		showSiteMap(function (err) {
			$(".site-map-picker").popup("close");
			done(err);
		}, function (page) {
			var group = page.find(".site-map-pin-group");

			assert.lengthOf(page.find(".site-map-pin"), 2);
			assert.lengthOf(group, 1);
			assert.equal(group.attr("data-sids"), "0,1");
			assert.equal(group.find(".site-map-pin-count").text(), "2");

			tap(group);
			assert.lengthOf($(".site-map-picker a[data-sid]"), 2);
			assert.isFalse(page.find(".site-map-container").hasClass("site-map-zoomed"));
		});
	});

	it("should separate nearby pins after zooming into their group", function (done) {
		var width;

		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		// Measure the rendered map first, then place two pins 20px apart at normal size
		showSiteMap(function (err) {
			if (err) {
				done(err);
				return;
			}
			OSApp.SiteMap.save(siteName, {
				image: testImage,
				pins: { 0: { x: 0.5, y: 0.5 }, 1: { x: 0.5 + 6 / width, y: 0.5 }, 2: { x: 0.5, y: 0.5 + 8 / width } }
			});
			showSiteMap(done, function (page) {
				assert.lengthOf(page.find(".site-map-pin"), 1);

				// One click zooms far enough to separate all three
				tap(page.find(".site-map-pin-group"));

				return nextFrame().then(function () {
					assert.lengthOf(page.find(".site-map-pin"), 3);
					assert.lengthOf(page.find(".site-map-pin-group"), 0);
					assert.lengthOf($(".site-map-picker"), 0);
				});
			});
		}, function (page) {
			width = page.find(".site-map-container").width();
			assert.isAbove(width, 0);
		});
	});

	it("should pan and zoom with the mouse and keyboard", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: { x: 0.5, y: 0.5 } } });

		showSiteMap(done, function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect(),
				image = page.find(".site-map-image-el")[0],
				x = rect.left + rect.width / 2,
				y = rect.top + rect.height / 2,
				key = function (name) {
					$(document).trigger($.Event("keydown", { key: name, target: document.body, originalEvent: { key: name } }));
				};

			// Wheel up zooms in around the cursor
			container[0].dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: x, clientY: y, bubbles: true, cancelable: true }));
			assert.isTrue(container.hasClass("site-map-zoomed"));
			assert.include(image.style.transform, "scale(2)");

			// Dragging the background pans the map
			var before = image.style.transform;
			pointer(container, "pointerdown", x, y);
			pointer(container, "pointermove", x - 40, y - 30);
			pointer(container, "pointerup", x - 40, y - 30);
			assert.notEqual(image.style.transform, before);
			assert.isFalse(container.hasClass("site-map-panning"));

			key("0");
			assert.isFalse(container.hasClass("site-map-zoomed"));
			key("+");
			assert.isTrue(container.hasClass("site-map-zoomed"));
			key("-");
			assert.isFalse(container.hasClass("site-map-zoomed"));
		});
	});

	it("should toggle edit mode", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		showSiteMap(done, function (page) {
			assert.isFalse(page.hasClass("site-map-editing"));
			page.find(".site-map-edit").trigger("click");
			assert.isTrue(page.hasClass("site-map-editing"));
			page.find(".site-map-edit").trigger("click");
			assert.isFalse(page.hasClass("site-map-editing"));
		});
	});

	// Resolves once check() returns true, polling each frame for up to two seconds
	function waitFor(check) {
		var started = Date.now();
		return new Promise(function (resolve, reject) {
			(function poll() {
				if (check()) {
					resolve();
				} else if (Date.now() - started > 2000) {
					reject(new Error("Timed out waiting for the site map"));
				} else {
					requestAnimationFrame(poll);
				}
			})();
		});
	}

	// Clicks an item in the open action list and waits for its action to run once the list closes
	function chooseAction(label) {
		return waitFor(function () {
			return $(".ui-popup-active .site-map-picker a").length > 0;
		}).then(function () {
			$(".ui-popup-active .site-map-picker a").filter(function () {
				return $(this).text() === label;
			}).trigger("click");
			return waitFor(function () {
				return !$(".ui-popup-active").length;
			});
		});
	}

	function tapMap(page, x, y) {
		var container = page.find(".site-map-container"),
			rect = container[0].getBoundingClientRect(),
			px = rect.left + x * rect.width,
			py = rect.top + y * rect.height,

			// Dispatch on whatever is drawn there, as a real tap would
			target = document.elementFromPoint(px, py) || container[0];
		pointer(target, "pointerdown", px, py);
		pointer(target, "pointerup", px, py);
	}

	function storedMap() {
		return new Promise(function (resolve) {
			OSApp.SiteMap.load(siteName, resolve);
		});
	}

	// Edits are kept until Done is tapped; this taps it and resolves with what was saved
	function doneEditing(page) {
		page.find(".site-map-edit").trigger("click");
		return storedMap();
	}

	it("should encode drawings as one line per run and drop runs for missing stations", function () {
		var drawings = {
				2: [{ type: "drip", pts: [[0.1, 0.2], [0.3, 0.4]] }],
				0: [{ type: "heads", pts: [[0.5, 0.5]] }, { type: "heads", pts: [[0.25, 0.75], [1, 0]] }]
			},
			text = OSApp.SiteMap.encodeDrawings(drawings);

		assert.equal(text, "h,0,5000,5000\nh,0,2500,7500,10000,0\nd,2,1000,2000,3000,4000\n");
		assert.deepEqual(OSApp.SiteMap.decodeDrawings(text), drawings);
		assert.deepEqual(Object.keys(OSApp.SiteMap.decodeDrawings(text, 2)), ["0"]);
		assert.equal(OSApp.SiteMap.encodeDrawings({}), "");

		// Malformed lines and runs with too few points are ignored
		assert.deepEqual(OSApp.SiteMap.decodeDrawings("x,0,1,1\nd,0,1,1\nh,0,1\nh,1,10000,0\n"), { 1: [{ type: "heads", pts: [[1, 0]] }] });
	});

	it("should draw a head at every point of a head run and dash drip lines", function (done) {
		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: { 0: { x: 0.1, y: 0.1 } },
			drawings: {
				0: [{ type: "heads", pts: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }],
				1: [{ type: "drip", pts: [[0.2, 0.8], [0.8, 0.8]] }]
			}
		});

		showSiteMap(done, function (page) {
			var size = { width: page.find(".site-map-container").width(), height: page.find(".site-map-container").height() },
				heads = page.find(".site-map-run-heads .site-map-head"),
				drip = page.find(".site-map-run-drip");

			assert.lengthOf(heads, 3);
			assert.closeTo(Number(heads[1].getAttribute("cx")), 0.5 * size.width, 0.5);
			assert.closeTo(Number(heads[1].getAttribute("cy")), 0.1 * size.height, 0.5);
			assert.lengthOf(drip, 1);
			assert.lengthOf(drip.find(".site-map-head"), 0);
			assert.notEqual(getComputedStyle(drip.find(".site-map-run-line")[0]).strokeDasharray, "none");

			// Handles only appear while editing
			assert.lengthOf(page.find(".site-map-handle"), 0);
			page.find(".site-map-edit").trigger("click");
			assert.lengthOf(page.find(".site-map-handle"), 5);
			page.find(".site-map-edit").trigger("click");
		});
	});

	it("should connect each run to its valve with a supply pipe", function (done) {
		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: { 0: { x: 0.1, y: 0.2 }, 1: { x: 0.9, y: 0.9 } },
			drawings: {
				0: [{ type: "heads", pts: [[0.4, 0.2], [0.6, 0.2]] }, { type: "drip", pts: [[0.1, 0.2], [0.1, 0.8]] }],
				2: [{ type: "heads", pts: [[0.5, 0.5]] }]
			}
		});

		showSiteMap(done, function (page) {
			var width = page.find(".site-map-container").width(),
				height = page.find(".site-map-container").height(),
				feeds = page.find(".site-map-run-feed");

			// The drip line starts at its valve and station 2 has no valve, so only the head run gets a pipe
			assert.lengthOf(feeds, 1);
			assert.equal(feeds.closest(".site-map-run").attr("class").indexOf("site-map-run-heads") !== -1, true);
			assert.closeTo(Number(feeds.attr("x1")), 0.1 * width, 0.5);
			assert.closeTo(Number(feeds.attr("y1")), 0.2 * height, 0.5);
			assert.closeTo(Number(feeds.attr("x2")), 0.4 * width, 0.5);
		});
	});

	it("should keep drawings on the image while zoomed", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: { 0: [{ type: "heads", pts: [[0.25, 0.75]] }] } });

		showSiteMap(done, function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect();

			container[0].dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: rect.left + 10, clientY: rect.top + 10, bubbles: true, cancelable: true }));
			return nextFrame().then(function () {
				var match = page.find(".site-map-image-el")[0].style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/),
					head = page.find(".site-map-head")[0],
					x = Number(match[1]), y = Number(match[2]), scale = Number(match[3]);

				assert.isAbove(scale, 1);
				assert.closeTo(Number(head.getAttribute("cx")), x + 0.25 * container.width() * scale, 0.5);
				assert.closeTo(Number(head.getAttribute("cy")), y + 0.75 * container.height() * scale, 0.5);
				page.find(".site-map-zoom-reset").trigger("click");
			});
		});
	});

	it("should color drawings by station state and dim the others while a station runs", function (done) {
		var stub = sinon.stub(OSApp.SiteMap, "getPinState").callsFake(function (sid) {
			return sid === 0 ? "running" : "idle";
		});

		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: {},
			drawings: { 0: [{ type: "heads", pts: [[0.2, 0.2]] }], 1: [{ type: "drip", pts: [[0.1, 0.9], [0.9, 0.9]] }] }
		});

		showSiteMap(function (err) {
			stub.restore();
			done(err);
		}, function (page) {
			var running = page.find(".site-map-run[data-sid='0']"),
				idle = page.find(".site-map-run[data-sid='1']");

			assert.isTrue(running.is(".site-map-run-running") && !running.is(".site-map-run-dim"));
			assert.isTrue(idle.is(".site-map-run-idle.site-map-run-dim"));
			assert.equal(getComputedStyle(running.find(".site-map-head")[0]).fill, "rgb(47, 168, 47)");
		});
	});

	it("should draw a head run point by point, starting at the valve", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: { x: 0.2, y: 0.5 } } });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add heads").then(function () {
				assert.isTrue(page.hasClass("site-map-drawing-mode"));
				assert.isTrue(page.find(".site-map-drawbar").is(":visible"));

				// Tapped close to the valve, so the pipe starts exactly at it
				tapMap(page, 0.205, 0.51);
				tapMap(page, 0.5, 0.5);
				tapMap(page, 0.5, 0.8);
				page.find(".site-map-draw-undo").trigger("click");
				tapMap(page, 0.6, 0.8);
				assert.lengthOf(page.find(".site-map-run-heads .site-map-head"), 3);

				page.find(".site-map-draw-done").trigger("click");
				assert.isFalse(page.hasClass("site-map-drawing-mode"));
				return doneEditing(page);
			}).then(function (map) {
				var pts = map.drawings[0][0].pts;
				assert.equal(map.drawings[0][0].type, "heads");
				assert.lengthOf(pts, 3);
				assert.deepEqual(pts[0], [0.2, 0.5]);
				assert.closeTo(pts[2][0], 0.6, 0.01);
			});
		});
	});

	it("should discard a drip line with fewer than two points", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 3: { x: 0.5, y: 0.5 } } });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add drip line").then(function () {
				tapMap(page, 0.9, 0.9);
				page.find(".site-map-draw-done").trigger("click");
				assert.lengthOf(page.find(".site-map-run"), 0);
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.drawings, {});
				page.find(".site-map-edit").trigger("click");
			});
		});
	});

	it("should move a point by dragging its handle and add points to an existing run", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: { 1: [{ type: "drip", pts: [[0.1, 0.1], [0.5, 0.1]] }] } });

		showSiteMap(done, function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect();

			page.find(".site-map-edit").trigger("click");
			pointer(page.find(".site-map-handle")[1], "pointerdown", rect.left + 0.5 * rect.width, rect.top + 0.1 * rect.height);
			pointer(container, "pointermove", rect.left + 0.5 * rect.width, rect.top + 0.4 * rect.height);
			pointer(container, "pointerup", rect.left + 0.5 * rect.width, rect.top + 0.4 * rect.height);

			return doneEditing(page).then(function (map) {
				assert.closeTo(map.drawings[1][0].pts[1][1], 0.4, 0.01);

				// Tapping the middle of the moved line opens its actions
				page.find(".site-map-edit").trigger("click");
				tapMap(page, 0.3, 0.25);
				return chooseAction("Add points");
			}).then(function () {
				tapMap(page, 0.7, 0.7);
				page.find(".site-map-draw-done").trigger("click");
				return doneEditing(page);
			}).then(function (map) {
				assert.lengthOf(map.drawings[1][0].pts, 3);
			});
		});
	});

	it("should run the station when its drawing is tapped", function (done) {
		var control;

		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: { 0: [{ type: "drip", pts: [[0.1, 0.5], [0.9, 0.5]] }] } });

		showSiteMap(function (err) {
			control.restore();
			$("#durationBox").popup("close");
			done(err);
		}, function (page) {
			control = sinon.stub(OSApp.UIDom, "showDurationBox");
			tapMap(page, 0.5, 0.5);
			assert.isTrue(control.calledOnce);
			assert.equal(control.firstCall.args[0].title, OSApp.Stations.getName(0));
		});
	});

	it("should remove a valve's drawings with it", function (done) {
		var confirm;

		OSApp.SiteMap.save(siteName, {
			image: testImage,
			pins: { 0: { x: 0.5, y: 0.5 } },
			drawings: { 0: [{ type: "heads", pts: [[0.5, 0.5]] }, { type: "drip", pts: [[0.1, 0.1], [0.2, 0.2]] }] }
		});

		showSiteMap(function (err) {
			confirm.restore();
			done(err);
		}, function (page) {
			confirm = sinon.stub(OSApp.UIDom, "areYouSure").callsFake(function (question, detail, yes) {
				assert.include(detail, "1 head runs");
				assert.include(detail, "1 drip lines");
				yes();
			});
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Remove from map").then(function () {
				assert.lengthOf(page.find(".site-map-run"), 0);
				return doneEditing(page);
			}).then(function (map) {
				assert.deepEqual(map.pins, {});
				assert.deepEqual(map.drawings, {});
			});
		});
	});

	it("should switch the home page between the station cards and the map", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (root) {
			var page = $("#sprinklers");

			var button = page.find(".home-view-button");

			assert.isTrue(root.is(":visible"));
			assert.isFalse(page.find("#os-stations-list").is(":visible"));

			// The button shows the icon of the view it switches to
			assert.isTrue(button.hasClass("ui-icon-bullets"));
			assert.equal(getComputedStyle(button[0]).position, "fixed");

			button.trigger("click");
			assert.isFalse(root.is(":visible"));
			assert.isTrue(page.find("#os-stations-list").is(":visible"));
			assert.isTrue(button.hasClass("ui-icon-location"));
			assert.equal(OSApp.SiteMap.getHomeView(), "cards");

			button.trigger("click");
			assert.isTrue(root.is(":visible"));
			assert.equal(OSApp.SiteMap.getHomeView(), "map");
		});
	});

	it("should show a loading message, not the add image prompt, until the controller's map arrives", function () {
		var pending = $.Deferred(),
			stub = sinon.stub(OSApp.SiteMap, "loadMap").callsFake(function (name, callback) {
				pending.then(function () {
					callback({ image: testImage, pins: {}, drawings: {} }, "local");
				});
			}),
			page = $("#sprinklers");

		// A fresh home page has never loaded its map
		$("#sprinklers").remove();
		OSApp.SiteMap.setHomeView("map");
		return new Promise(function (resolve) {
			$.mobile.document.one("pageshow", "#sprinklers", resolve);
			OSApp.UIDom.changePage("#sprinklers");
		}).then(function () {
			var root = $("#sprinklers .site-map-view");

			assert.isTrue(root.find(".site-map-loading-text").is(":visible"));
			assert.isFalse(root.find(".site-map-empty-prompt").is(":visible"));
			pending.resolve();
			assert.isFalse(root.find(".site-map-loading-text").is(":visible"));
			assert.isFalse(root.find(".site-map-empty-prompt").is(":visible"));
		}).finally(function () {
			stub.restore();
			page = null;
		});
	});

	it("should animate zooming into a group of valves", function () {
		var width;

		OSApp.SiteMap.Constants.zoomDuration = 200;
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (page) {
			width = page.find(".site-map-container").width();
			OSApp.SiteMap.save(siteName, {
				image: testImage,
				pins: { 0: { x: 0.5, y: 0.5 }, 1: { x: 0.5 + 6 / width, y: 0.5 } }
			});
			return openHomeMap();
		}).then(function (page) {
			var image = page.find(".site-map-image-el")[0],
				scaleOf = function () {
					var match = image.style.transform.match(/scale\(([\d.]+)\)/);
					return match ? Number(match[1]) : 1;
				},
				samples = [];

			tap(page.find(".site-map-pin-group"));

			// Partway through, the zoom is between the start and the end
			return new Promise(function (resolve) {
				setTimeout(function () {
					samples.push(scaleOf());
					setTimeout(function () {
						samples.push(scaleOf());
						resolve();
					}, 300);
				}, 80);
			}).then(function () {
				assert.isAbove(samples[0], 1);
				assert.isBelow(samples[0], samples[1]);
				assert.lengthOf(page.find(".site-map-pin"), 2);
			});
		}).finally(function () {
			OSApp.SiteMap.Constants.zoomDuration = 0;
		});
	});

	// Waits for layout work queued by a resize (ResizeObserver and animation frames) to settle
	function settle() {
		return new Promise(function (resolve) {
			setTimeout(resolve, 100);
		}).then(nextFrame);
	}

	function pageFitsWindow() {
		var page = $("#sprinklers")[0];
		assert.isAtMost(document.documentElement.scrollHeight, window.innerHeight + 1, "the page scrolls");
		assert.isAtLeast(page.offsetHeight, window.innerHeight - 1, "the page doesn't reach the bottom of the window");
	}

	it("should fill the window without scrolling in map view", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });
		return openHomeMap().then(settle).then(pageFitsWindow);
	});

	it("should stretch the page to the window again when switching from the cards to the map", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function () {
			// Make the card view taller than the window, so jQuery Mobile drops its minimum height
			$("#os-stations-list").append("<div class='layout-test-filler' style='height:2000px'></div>");
			OSApp.SiteMap.setHomeView("cards");
			$.mobile.resetActivePageHeight();
			OSApp.SiteMap.setHomeView("map");
			return settle();
		}).then(pageFitsWindow).finally(function () {
			$(".layout-test-filler").remove();
		});
	});

	// A wide image, so the map is limited by the window's width and ends above the bottom of the window,
	// like a square photo on a phone
	function wideImage() {
		var canvas = document.createElement("canvas");
		canvas.width = 400;
		canvas.height = 80;
		canvas.getContext("2d").fillRect(0, 0, 400, 80);
		return canvas.toDataURL("image/jpeg");
	}

	it("should stretch the page again when the map is refitted smaller", function () {
		OSApp.SiteMap.save(siteName, { image: wideImage(), pins: {} });

		return openHomeMap().then(function (root) {
			// Like opening straight into map view: the page height is set while the map is still taller
			// than the window, then the map is fitted to the screen
			root.find(".site-map-container").css("height", "2000px");
			$.mobile.resetActivePageHeight();
			assert.equal($("#sprinklers")[0].style.minHeight, "");

			$("#sprinklers .info-card").first().hide().show();
			$(window).trigger("resize.sitemap");
			return settle();
		}).then(function () {
			var root = $("#sprinklers .site-map-view"),
				mapBottom = root.find(".site-map-container")[0].getBoundingClientRect().bottom;

			// The map really is shorter than the window here, so only the page's minimum height fills the gap
			assert.isBelow(mapBottom, window.innerHeight - 50);
			pageFitsWindow();
		});
	});

	it("should refit the map when the content above it changes size", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (root) {
			var card = $("#sprinklers .info-card").first(),
				before = root.find(".site-map-container").height(),
				cardHeight = card.outerHeight(true);

			// Like the weather loading into the card above the map after the map was first sized,
			// but in reverse: the room above shrinks, so the map can grow into it
			card.hide();
			return settle().then(function () {
				assert.isAbove(root.find(".site-map-container").height(), before + cardHeight / 2);
				pageFitsWindow();

				card.show();
				return settle();
			}).then(function () {
				assert.closeTo(root.find(".site-map-container").height(), before, 1);
				pageFitsWindow();
			});
		}).finally(function () {
			$("#sprinklers .info-card").first().show();
		});
	});

	it("should restore an existing run when adding points is cancelled", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: { 1: [{ type: "drip", pts: [[0.1, 0.6], [0.4, 0.6]] }] } });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tapMap(page, 0.25, 0.6);
			return chooseAction("Add points").then(function () {
				tapMap(page, 0.6, 0.8);
				tapMap(page, 0.7, 0.8);
				page.find(".site-map-draw-cancel").trigger("click");
				assert.isFalse(page.hasClass("site-map-drawing-mode"));
				assert.lengthOf(page.find(".site-map-run-drip .site-map-handle"), 2);
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.drawings, { 1: [{ type: "drip", pts: [[0.1, 0.6], [0.4, 0.6]] }] });
				page.find(".site-map-edit").trigger("click");
			});
		});
	});

	it("should discard a new run when drawing is cancelled", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 2: { x: 0.3, y: 0.6 } } });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add heads").then(function () {
				tapMap(page, 0.4, 0.6);
				tapMap(page, 0.5, 0.6);
				assert.lengthOf(page.find(".site-map-head"), 2);
				page.find(".site-map-draw-cancel").trigger("click");
				assert.lengthOf(page.find(".site-map-run"), 0);
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.drawings, {});
				page.find(".site-map-edit").trigger("click");
			});
		});
	});

	it("should remove the last point of a run", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: { 1: [{ type: "drip", pts: [[0.1, 0.6], [0.4, 0.6], [0.4, 0.8]] }] } });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tapMap(page, 0.25, 0.6);
			return chooseAction("Remove last point").then(function () {
				return doneEditing(page);
			}).then(function (map) {
				assert.deepEqual(map.drawings[1][0].pts, [[0.1, 0.6], [0.4, 0.6]]);

				// A drip line can't go below two points, so the action is no longer offered
				page.find(".site-map-edit").trigger("click");
				tapMap(page, 0.25, 0.6);
				return waitFor(function () {
					return $(".ui-popup-active .site-map-picker a").length > 0;
				});
			}).then(function () {
				var labels = $(".ui-popup-active .site-map-picker a").map(function () {
					return $(this).text();
				}).get();
				assert.notInclude(labels, "Remove last point");
				return chooseAction("Add points");
			}).then(function () {
				page.find(".site-map-draw-cancel").trigger("click");
				page.find(".site-map-edit").trigger("click");
			});
		});
	});

	function scaleOf(page) {
		var match = page.find(".site-map-image-el")[0].style.transform.match(/scale\(([\d.]+)\)/);
		return match ? Number(match[1]) : 1;
	}

	it("should stop a zoom animation when the map is dragged", function () {
		OSApp.SiteMap.Constants.zoomDuration = 300;
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect(),
				x = rect.left + rect.width / 2,
				y = rect.top + rect.height / 2;

			page.find(".site-map-zoom-in").trigger("click");
			return new Promise(function (resolve) {
				setTimeout(resolve, 60);
			}).then(function () {
				var midway = scaleOf(page);

				pointer(container, "pointerdown", x, y);
				pointer(container, "pointermove", x - 30, y - 20);
				pointer(container, "pointerup", x - 30, y - 20);
				return new Promise(function (resolve) {
					setTimeout(resolve, 400);
				}).then(function () {
					assert.isBelow(scaleOf(page), 2);
					assert.closeTo(scaleOf(page), midway, 0.15);
				});
			});
		}).finally(function () {
			OSApp.SiteMap.Constants.zoomDuration = 0;
		});
	});

	it("should zoom without animating when reduced motion is requested", function () {
		var matchMedia = sinon.stub(window, "matchMedia").callsFake(function (query) {
			return { matches: /prefers-reduced-motion/.test(query), media: query, addListener: function () {}, removeListener: function () {} };
		});

		OSApp.SiteMap.Constants.zoomDuration = 300;
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (page) {
			page.find(".site-map-zoom-in").trigger("click");
			assert.equal(scaleOf(page), 2);
		}).finally(function () {
			matchMedia.restore();
			OSApp.SiteMap.Constants.zoomDuration = 0;
		});
	});

	it("should let the map be dragged clear of the buttons on the right, even at normal zoom", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });

		return openHomeMap().then(function (page) {
			// Put the valve right under the Edit button
			var map = page.find(".site-map-container")[0].getBoundingClientRect(),
				button = page.find(".site-map-edit")[0].getBoundingClientRect();

			OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: {
				x: ( button.left + button.width / 2 - map.left ) / map.width,
				y: ( button.top + button.height / 2 - map.top ) / map.height
			} } });
			return openHomeMap();
		}).then(function (page) {
			var container = page.find(".site-map-container"),
				controls = page.find(".site-map-controls"),
				rect = container[0].getBoundingClientRect(),
				image = page.find(".site-map-image-el")[0],
				pinCenter = function () {
					var r = page.find(".site-map-pin")[0].getBoundingClientRect();
					return [r.left + r.width / 2, r.top + r.height / 2];
				},
				hit = function () {
					return document.elementFromPoint.apply(document, pinCenter());
				},
				drag = function (dx) {
					var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
					pointer(container, "pointerdown", x, y);
					pointer(container, "pointermove", x + dx / 2, y);
					pointer(container, "pointermove", x + dx, y);
					pointer(container, "pointerup", x + dx, y);
				},
				limit = controls.outerWidth() + 8;

			// The valve starts under the button column, where a tap would hit a button
			assert.isTrue($(hit()).closest(".site-map-controls").length > 0);

			drag(-60);
			return nextFrame().then(function () {
				assert.isTrue($(hit()).closest(".site-map-pin").length > 0);

				// Only as far as the button column is wide
				drag(-500);
				assert.include(image.style.transform, "translate(-" + limit + "px");
				drag(1000);
				assert.include(image.style.transform, "translate(0px");
			});
		});
	});

	it("should not open the side menu or notifications when swiping on the map", function () {
		var swipes = [],

			// Stands in for the app's page-level handler that opens the menu or notifications on a swipe
			pageSwipe = function (event) {
				swipes.push(event.type);
			};

		$.mobile.document.on("swiperight.sitemaptest swipeleft.sitemaptest", ".ui-page", pageSwipe);
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {} });
		return openHomeMap().then(function (page) {
			page.find(".site-map-container").trigger("swiperight").trigger("swipeleft");
			assert.deepEqual(swipes, []);

			// Swiping elsewhere on the home page still reaches it
			$("#sprinklers .info-card").trigger("swiperight");
			assert.deepEqual(swipes, ["swiperight"]);
		}).finally(function () {
			$.mobile.document.off(".sitemaptest");
		});
	});

	it("should allow dragging past the right edge only by the given amount", function () {
		assert.deepEqual(OSApp.SiteMap.clampView({ scale: 1, x: -100, y: 0 }, 400, 200, 8, 40), { scale: 1, x: -40, y: 0 });
		assert.deepEqual(OSApp.SiteMap.clampView({ scale: 1, x: 10, y: -5 }, 400, 200, 8, 40), { scale: 1, x: 0, y: 0 });
		assert.deepEqual(OSApp.SiteMap.clampView({ scale: 2, x: -500, y: 0 }, 400, 200, 8, 40), { scale: 2, x: -440, y: 0 });
	});

	it("should leave the zoom buttons off on touch screens", function () {
		var hidden = [].some.call(document.styleSheets, function (sheet) {
			var rules;
			try {
				rules = sheet.cssRules;
			} catch (error) {
				return false;
			}
			return [].some.call(rules || [], function (rule) {
				return rule.media && /pointer:\s*coarse/.test(rule.conditionText || rule.media.mediaText) &&
					[].some.call(rule.cssRules, function (inner) {
						return inner.selectorText === ".site-map-zoom" && inner.style.display === "none";
					});
			});
		});
		assert.isTrue(hidden);
	});

	it("should keep edits until Done and then save them", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: { x: 0.2, y: 0.5 } }, drawings: {} });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			assert.isTrue(page.find(".site-map-cancel").is(":visible"));
			tap(page.find(".site-map-pin"));
			return chooseAction("Add drip line").then(function () {
				tapMap(page, 0.3, 0.5);
				tapMap(page, 0.6, 0.5);
				page.find(".site-map-draw-done").trigger("click");
				return storedMap();
			}).then(function (map) {
				// Nothing is saved while still editing
				assert.deepEqual(map.drawings, {});
				return doneEditing(page);
			}).then(function (map) {
				assert.lengthOf(map.drawings[0], 1);
				assert.isFalse(page.find(".site-map-cancel").is(":visible"));
			});
		});
	});

	it("should put everything back when an edit is cancelled", function (done) {
		var original = {
			image: testImage,
			pins: { 0: { x: 0.2, y: 0.5 }, 1: { x: 0.7, y: 0.5 } },
			drawings: { 1: [{ type: "drip", pts: [[0.7, 0.5], [0.7, 0.8]] }] }
		};
		OSApp.SiteMap.save(siteName, original);

		showSiteMap(done, function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect(),
				confirm = sinon.stub(OSApp.UIDom, "areYouSure").callsFake(function (question, detail, yes) {
					yes();
				});

			page.find(".site-map-edit").trigger("click");

			// Move a point, remove a valve with its drawings, and add a head run
			pointer(page.find(".site-map-handle")[1], "pointerdown", rect.left + 0.7 * rect.width, rect.top + 0.8 * rect.height);
			pointer(container, "pointermove", rect.left + 0.9 * rect.width, rect.top + 0.9 * rect.height);
			pointer(container, "pointerup", rect.left + 0.9 * rect.width, rect.top + 0.9 * rect.height);
			tap(page.find(".site-map-pin[data-sids='1']"));
			return chooseAction("Remove from map").then(function () {
				confirm.restore();
				tap(page.find(".site-map-pin[data-sids='0']"));
				return chooseAction("Add heads");
			}).then(function () {
				tapMap(page, 0.3, 0.5);
				page.find(".site-map-draw-done").trigger("click");
				assert.lengthOf(page.find(".site-map-pin"), 1);

				page.find(".site-map-cancel").trigger("click");
				assert.isFalse(page.hasClass("site-map-editing"));

				// Back on screen as it was, and nothing was saved
				assert.lengthOf(page.find(".site-map-pin"), 2);
				assert.lengthOf(page.find(".site-map-run"), 1);
				assert.lengthOf(page.find(".site-map-run-heads"), 0);
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.pins, original.pins);
				assert.deepEqual(map.drawings, original.drawings);
			}).finally(function () {
				confirm.restore();
			});
		});
	});

	it("should confirm a saved edit, but not a cancelled or empty one", function () {
		var message = sinon.stub(OSApp.Errors, "showError"),
			saved = function () {
				return message.getCalls().filter(function (call) {
					return call.args[0] === "Settings have been saved";
				}).length;
			};

		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: { x: 0.2, y: 0.5 } }, drawings: {} });
		return openHomeMap().then(function (page) {
			// Nothing changed
			page.find(".site-map-edit").trigger("click").trigger("click");
			assert.equal(saved(), 0);

			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add heads").then(function () {
				tapMap(page, 0.4, 0.5);
				page.find(".site-map-draw-done").trigger("click");
				page.find(".site-map-cancel").trigger("click");
				assert.equal(saved(), 0);

				page.find(".site-map-edit").trigger("click");
				tap(page.find(".site-map-pin"));
				return chooseAction("Add heads");
			}).then(function () {
				tapMap(page, 0.4, 0.5);
				page.find(".site-map-draw-done").trigger("click");
				page.find(".site-map-edit").trigger("click");
				assert.equal(saved(), 1);
			});
		}).finally(function () {
			message.restore();
		});
	});

	it("should discard an edit when leaving the map without saving", function () {
		var original = { image: testImage, pins: { 0: { x: 0.2, y: 0.5 } }, drawings: {} };

		OSApp.SiteMap.save(siteName, original);
		return openHomeMap().then(function (page) {
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add drip line").then(function () {
				tapMap(page, 0.3, 0.5);
				tapMap(page, 0.6, 0.5);
				page.find(".site-map-draw-done").trigger("click");

				// Switching to the cards leaves the map
				OSApp.SiteMap.setHomeView("cards");
				assert.isFalse(page.hasClass("site-map-editing"));
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.drawings, {});
				OSApp.SiteMap.setHomeView("map");
				assert.lengthOf(page.find(".site-map-run"), 0);
			});
		});
	});

	it("should mark save, cancel and clear clearly while editing", function () {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: {} });

		return openHomeMap().then(function (page) {
			var edit = page.find(".site-map-edit");

			assert.isTrue(edit.hasClass("ui-icon-edit") && !edit.hasClass("green"));
			edit.trigger("click");
			assert.isTrue(edit.hasClass("ui-icon-check") && edit.hasClass("green"));
			assert.equal(edit.attr("title"), "Save changes");
			assert.isTrue(page.find(".site-map-cancel").is(".ui-icon-delete.red"));
			assert.isTrue(page.find(".site-map-clear").hasClass("ui-icon-back"));
			assert.isFalse(page.find(".site-map-clear").hasClass("red"));
			page.find(".site-map-cancel").trigger("click");
			assert.isFalse(edit.hasClass("green"));
		});
	});

	it("should discard a drawing in progress when an edit is cancelled", function (done) {
		OSApp.SiteMap.save(siteName, { image: testImage, pins: { 0: { x: 0.2, y: 0.5 } }, drawings: {} });

		showSiteMap(done, function (page) {
			page.find(".site-map-edit").trigger("click");
			tap(page.find(".site-map-pin"));
			return chooseAction("Add heads").then(function () {
				tapMap(page, 0.3, 0.5);
				tapMap(page, 0.4, 0.5);
				page.find(".site-map-cancel").trigger("click");
				assert.isFalse(page.hasClass("site-map-drawing-mode"));
				assert.lengthOf(page.find(".site-map-run"), 0);
				return storedMap();
			}).then(function (map) {
				assert.deepEqual(map.drawings, {});
			});
		});
	});

	it("should keep a new image until Done and restore the old one on cancel", function (done) {
		var picture = sinon.stub(OSApp.UIDom, "getPicture").callsFake(function (callback) {
				callback("/9j/new");
			});

		OSApp.SiteMap.save(siteName, { image: testImage, pins: {}, drawings: {} });
		showSiteMap(function (error) {
			picture.restore();
			done(error);
		}, function (page) {
			var img = page.find(".site-map-image-el");

			page.find(".site-map-edit").trigger("click");
			page.find(".site-map-image").trigger("click");
			assert.equal(img.attr("src"), "data:image/jpeg;base64,/9j/new");
			page.find(".site-map-cancel").trigger("click");
			assert.equal(img.attr("src"), testImage);
			return storedMap().then(function (map) {
				assert.equal(map.image, testImage);

				page.find(".site-map-edit").trigger("click");
				page.find(".site-map-image").trigger("click");
				return doneEditing(page);
			}).then(function (map) {
				assert.equal(map.image, "data:image/jpeg;base64,/9j/new");
			});
		});
	});

	it("should not list the site map in the menu", function () {
		assert.lengthOf($("#sprinklers-settings a[href='#site-map']"), 0);
	});

	it("should report pin state from station status", function () {
		var stub = sinon.stub(OSApp.Stations, "isDisabled").returns(true);
		try {
			assert.equal(OSApp.SiteMap.getPinState(0), "disabled");
		} finally {
			stub.restore();
		}
	});

	it("should show the site map with the keyboard shortcut", function () {
		OSApp.SiteMap.setHomeView("cards");
		OSApp.UIDom.handleKeydown($.Event("keydown", { keyCode: 65, altKey: true, target: document.body }));
		assert.equal(OSApp.SiteMap.getHomeView(), "map");
		assert.isTrue($("#sprinklers .site-map-view").is(":visible"));
	});
});

describe("Site Map Controller Storage", function () {
	var siteName, sandbox, remote, requests, previousOptions;

	function jpeg(color) {
		var canvas = document.createElement("canvas");
		canvas.width = 40;
		canvas.height = 30;
		var context = canvas.getContext("2d");
		context.fillStyle = color || "#3a7";
		context.fillRect(0, 0, 40, 30);
		return canvas.toDataURL("image/jpeg", 0.9);
	}

	function resolved(value) {
		return $.Deferred().resolve(value).promise();
	}

	function asNative(promise) {
		return new Promise(function (resolve, reject) {
			promise.then(resolve, reject);
		});
	}

	function query(dest) {
		return new URLSearchParams(dest.split("?")[1] || "");
	}

	// In-memory stand-in for the firmware endpoints
	function installController(initial) {
		remote = $.extend({ rev: 0, pins: {}, image: null, upload: "", drawings: "", drawingUpload: "" }, initial);
		requests = [];
		OSApp.currentSession.controller.options.smap = remote.rev;
		sandbox.stub(OSApp.Firmware, "sendToOS").callsFake(function (dest, type, options) {
			var path = dest.split("?")[0],
				params = query(dest);
			requests.push({ path: path, params: params, body: options && options.body });

			if (path === "/jm") {
				return resolved({
					rev: remote.rev,
					img: remote.image ? atob(remote.image.split(",")[1]).length : 0,
					drw: remote.drawings.length,
					pins: Object.keys(remote.pins).map(function (sid) {
						return [Number(sid), remote.pins[sid][0], remote.pins[sid][1]];
					})
				});
			}
			if (path === "/jmi") {
				var bytes = Uint8Array.from(atob(remote.image.split(",")[1]), function (c) {
					return c.charCodeAt(0);
				});
				return resolved(new Blob([bytes], { type: "image/jpeg" }));
			}
			if (path === "/cmp") {
				var text = options.body || params.get("p") || "";
				remote.pins = {};
				text.split(";").filter(Boolean).forEach(function (pin) {
					var parts = pin.split(",").map(Number);
					remote.pins[parts[0]] = [parts[1], parts[2]];
				});
				remote.rev++;
				return resolved({ result: 1 });
			}
			if (path === "/um") {
				if (Number(params.get("off")) === 0) remote.upload = "";
				remote.upload += options.body;
				if (atob(remote.upload).length === Number(params.get("tot"))) {
					remote.image = "data:image/jpeg;base64," + remote.upload;
					remote.rev++;
				}
				return resolved({ result: 1 });
			}
			if (path === "/umd") {
				if (Number(params.get("tot")) === 0) {
					remote.drawings = "";
					remote.rev++;
					return resolved({ result: 1 });
				}
				if (Number(params.get("off")) === 0) remote.drawingUpload = "";
				remote.drawingUpload += options.body;
				if (remote.drawingUpload.length === Number(params.get("tot"))) {
					remote.drawings = remote.drawingUpload;
					remote.rev++;
				}
				return resolved({ result: 1 });
			}
			if (path === "/jmd") {
				return resolved(remote.drawings);
			}
			if (path === "/dm") {
				remote.pins = {};
				remote.image = null;
				remote.drawings = "";
				remote.rev++;
				return resolved({ result: 1 });
			}
			return $.Deferred().reject({ status: 404 }).promise();
		});
	}

	function requestsTo(path) {
		return requests.filter(function (request) {
			return request.path === path;
		});
	}

	function loadMap() {
		return new Promise(function (resolve) {
			OSApp.SiteMap.loadMap(siteName, function (map, source) {
				resolve({ map: map, source: source });
			});
		});
	}

	before(function (done) {
		OSApp.Storage.get("current_site", function (data) {
			siteName = data.current_site || "default";
			done();
		});
	});

	beforeEach(function () {
		sandbox = sinon.createSandbox();
		sandbox.stub(OSApp.Errors, "showError");
		previousOptions = OSApp.currentSession.controller.options;
		OSApp.currentSession.controller.options = $.extend({}, previousOptions);
		OSApp.Storage.remove(OSApp.SiteMap.getStorageKey(siteName));
	});

	afterEach(function () {
		sandbox.restore();
		OSApp.currentSession.controller.options = previousOptions;
		OSApp.Storage.remove(OSApp.SiteMap.getStorageKey(siteName));
	});

	it("should encode pins as station, x and y from 0 to 10000", function () {
		var encoded = OSApp.SiteMap.encodePins({ 3: { x: 0.25, y: 1.2 }, 0: { x: 0, y: 0.33333 } });

		assert.equal(encoded, "0,0,3333;3,2500,10000");
		assert.deepEqual(OSApp.SiteMap.decodePins([[0, 0, 3333], [3, 2500, 10000]]),
			{ 0: { x: 0, y: 0.3333 }, 3: { x: 0.25, y: 1 } });
		assert.equal(OSApp.SiteMap.encodePins({}), "");
	});

	it("should split an image into base64 chunks that decode on their own", function () {
		var image = jpeg(),
			base64 = image.split(",")[1],
			upload = OSApp.SiteMap.getImageChunks(image, 400),
			decoded = "";

		assert.equal(upload.total, atob(base64).length);
		upload.chunks.forEach(function (chunk) {
			assert.equal(chunk.offset, decoded.length);
			assert.isAtMost(chunk.body.length, 400);
			decoded += atob(chunk.body);
		});
		assert.equal(decoded, atob(base64));
		assert.equal(OSApp.SiteMap.Constants.uploadChunkChars % 4, 0);
	});

	it("should detect support from the smap option", function () {
		delete OSApp.currentSession.controller.options.smap;
		assert.isFalse(OSApp.SiteMap.isControllerSupported());
		OSApp.currentSession.controller.options.smap = 0;
		assert.isTrue(OSApp.SiteMap.isControllerSupported());
	});

	it("should use device storage when the controller can't store the map", function () {
		var stub = sandbox.stub(OSApp.Firmware, "sendToOS");
		delete OSApp.currentSession.controller.options.smap;
		OSApp.SiteMap.save(siteName, { pins: { 1: { x: 0.5, y: 0.5 } } });

		return loadMap().then(function (result) {
			assert.equal(result.source, "local");
			assert.deepEqual(result.map.pins, { 1: { x: 0.5, y: 0.5 } });
			assert.isFalse(stub.called);
		});
	});

	it("should fall back to device storage when the controller lacks the endpoints", function () {
		sandbox.stub(OSApp.Firmware, "sendToOS").returns($.Deferred().reject({ status: 404 }).promise());
		OSApp.currentSession.controller.options.smap = 0;
		OSApp.SiteMap.save(siteName, { pins: { 2: { x: 0.1, y: 0.2 } } });

		return loadMap().then(function (result) {
			assert.equal(result.source, "local");
			assert.deepEqual(result.map.pins, { 2: { x: 0.1, y: 0.2 } });
		});
	});

	it("should move a map saved on this device to the controller once", function () {
		var image = jpeg();
		installController();
		OSApp.SiteMap.save(siteName, { image: image, pins: { 0: { x: 0.5, y: 0.25 } } });

		return loadMap().then(function (first) {
			assert.equal(first.source, "controller");
			assert.equal(remote.image, image);
			assert.deepEqual(remote.pins, { 0: [5000, 2500] });
			assert.isAbove(requestsTo("/um").length, 0);
			assert.equal(first.map.rev, remote.rev);
			assert.isTrue(OSApp.Errors.showError.calledWith("Site map saved to the controller"));

			requests = [];
			return loadMap();
		}).then(function (second) {
			assert.lengthOf(requestsTo("/um"), 0);
			assert.lengthOf(requestsTo("/cmp"), 0);
			assert.equal(second.map.image, image);
		});
	});

	it("should not overwrite a map already on the controller", function () {
		var image = jpeg("#c33");
		installController({ rev: 4, pins: { 1: [100, 200] }, image: image });
		OSApp.SiteMap.save(siteName, { pins: { 0: { x: 0.5, y: 0.5 } } });

		return loadMap().then(function (result) {
			assert.lengthOf(requestsTo("/cmp"), 0);
			assert.deepEqual(result.map.pins, { 1: { x: 0.01, y: 0.02 } });
			assert.equal(result.map.image, image);
		});
	});

	it("should only download the image when the controller's map has changed", function () {
		installController({ rev: 2, pins: {}, image: jpeg() });

		return loadMap().then(function () {
			assert.lengthOf(requestsTo("/jmi"), 1);
			requests = [];
			return loadMap();
		}).then(function () {
			assert.lengthOf(requestsTo("/jmi"), 0);
			remote.rev++;
			return loadMap();
		}).then(function () {
			assert.lengthOf(requestsTo("/jmi"), 1);
		});
	});

	it("should clear all pins with an empty p parameter", function () {
		installController({ rev: 1, pins: { 1: [1, 1] } });

		return asNative(OSApp.SiteMap.uploadPins({})).then(function () {
			var request = requestsTo("/cmp")[0];
			assert.equal(request.params.get("p"), "");
			assert.equal(request.body, "");
			assert.deepEqual(remote.pins, {});
		});
	});

	it("should restore a backup to the controller without pins for missing stations", function () {
		var image = jpeg();
		installController({ rev: 3 });

		return new Promise(function (resolve) {
			OSApp.SiteMap.restoreBackupData({ image: image, pins: { 0: { x: 0.5, y: 0.5 }, 999: { x: 0.1, y: 0.1 } } }, resolve);
		}).then(function () {
			assert.equal(remote.image, image);
			assert.deepEqual(remote.pins, { 0: [5000, 5000] });
		});
	});

	it("should restore a backup to this device when the controller can't store the map", function () {
		delete OSApp.currentSession.controller.options.smap;

		return new Promise(function (resolve) {
			OSApp.SiteMap.restoreBackupData({ pins: { 0: { x: 0.5, y: 0.5 } }, image: "javascript:alert(1)" }, resolve);
		}).then(function () {
			return new Promise(function (resolve) {
				OSApp.SiteMap.load(siteName, resolve);
			});
		}).then(function (map) {
			assert.deepEqual(map.pins, { 0: { x: 0.5, y: 0.5 } });
			assert.isUndefined(map.image);
		});
	});

	it("should leave the map alone when a backup has none", function () {
		var stub = sandbox.stub(OSApp.Firmware, "sendToOS");
		OSApp.SiteMap.save(siteName, { pins: { 0: { x: 0.5, y: 0.5 } } });

		return new Promise(function (resolve) {
			OSApp.SiteMap.restoreBackupData(undefined, resolve);
		}).then(function () {
			assert.isFalse(stub.called);
			return new Promise(function (resolve) {
				OSApp.SiteMap.load(siteName, resolve);
			});
		}).then(function (map) {
			assert.deepEqual(map.pins, { 0: { x: 0.5, y: 0.5 } });
		});
	});

	it("should include this device's copy in a backup when the controller can't be reached", function () {
		sandbox.stub(OSApp.Firmware, "sendToOS").returns($.Deferred().reject({ status: 0 }).promise());
		OSApp.currentSession.controller.options.smap = 2;
		OSApp.SiteMap.save(siteName, { pins: { 0: { x: 0.5, y: 0.5 } }, rev: 2 });

		return new Promise(function (resolve) {
			OSApp.SiteMap.getBackupData(resolve);
		}).then(function (siteMap) {
			assert.deepEqual(siteMap, { pins: { 0: { x: 0.5, y: 0.5 } }, drawings: {}, image: undefined });
		});
	});

	it("should upload drawings in chunks and reuse them while the map is unchanged", function () {
		var drawings = { 0: [] };
		for (var index = 0; index < 400; index++) {
			drawings[0].push({ type: "drip", pts: [[index / 400, 0.5], [index / 400, 0.6]] });
		}
		installController();

		return asNative(OSApp.SiteMap.uploadDrawings(drawings)).then(function () {
			assert.isAbove(requestsTo("/umd").length, 1);
			requestsTo("/umd").forEach(function (request) {
				assert.isAtMost(request.body.length, OSApp.SiteMap.Constants.uploadChunkChars);
			});
			assert.equal(remote.drawings, OSApp.SiteMap.encodeDrawings(drawings));
			return loadMap();
		}).then(function (first) {
			assert.lengthOf(first.map.drawings[0], 400);
			requests = [];
			return loadMap();
		}).then(function (second) {
			assert.lengthOf(requestsTo("/jmd"), 0);
			assert.lengthOf(second.map.drawings[0], 400);
		});
	});

	it("should clear drawings on the controller with tot=0", function () {
		installController({ rev: 2, drawings: "d,0,1,1,2,2\n" });

		return asNative(OSApp.SiteMap.uploadDrawings({})).then(function () {
			assert.equal(requestsTo("/umd")[0].params.get("tot"), "0");
			assert.equal(remote.drawings, "");
		});
	});

	it("should move drawings saved on this device to the controller", function () {
		installController();
		OSApp.SiteMap.save(siteName, { pins: { 0: { x: 0.5, y: 0.5 } }, drawings: { 0: [{ type: "heads", pts: [[0.5, 0.5], [0.6, 0.5]] }] } });

		return loadMap().then(function () {
			assert.equal(remote.drawings, "h,0,5000,5000,6000,5000\n");
		});
	});

	it("should upload drawing edits to the controller", function (done) {
		this.timeout(6000);
		installController({ rev: 1, pins: { 0: [5000, 5000] }, image: jpeg() });

		openHomeMap().then(function () {
			setTimeout(function () {
				var page = $("#sprinklers .site-map-view"),
					container = page.find(".site-map-container"),
					rect = container[0].getBoundingClientRect(),
					tapAt = function (x, y) {
						var e = { bubbles: true, cancelable: true, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height, pointerId: 1, pointerType: "mouse", button: 0 };
						container[0].dispatchEvent(new PointerEvent("pointerdown", e));
						container[0].dispatchEvent(new PointerEvent("pointerup", e));
					};

				try {
					page.find(".site-map-edit").trigger("click");
					page.find(".site-map-pin")[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0 }));
					page.find(".site-map-pin")[0].dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0 }));
				} catch (error) {
					done(error);
					return;
				}
				setTimeout(function () {
					$(".ui-popup-active .site-map-picker a").filter(function () {
						return $(this).text() === "Add drip line";
					}).trigger("click");
					setTimeout(function () {
						try {
							tapAt(0.5, 0.5);
							tapAt(0.8, 0.5);
							page.find(".site-map-draw-done").trigger("click");
							page.find(".site-map-edit").trigger("click");
						} catch (error) {
							done(error);
							return;
						}
						setTimeout(function () {
							try {
								assert.equal(remote.drawings, "d,0,5000,5000,8000,5000\n");
								OSApp.SiteMap.setHomeView("cards");
								done();
							} catch (error) {
								done(error);
							}
						}, OSApp.SiteMap.Constants.pinSaveDelay + 300);
					}, 600);
				}, 600);
			}, 300);
		});
	});

	it("should upload nothing until Done, and nothing at all if the edit is cancelled", function () {
		this.timeout(6000);
		installController({ rev: 1, pins: { 0: [5000, 5000] }, image: jpeg() });

		return openHomeMap().then(function (page) {
			var container = page.find(".site-map-container"),
				rect = container[0].getBoundingClientRect(),
				pointer = function (element, type, x, y) {
					element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
				},
				drag = function (toX) {
					var handle = page.find(".site-map-pin")[0], r = handle.getBoundingClientRect();
					pointer(handle, "pointerdown", r.left + r.width / 2, r.top + r.height / 2);
					pointer(handle, "pointermove", rect.left + toX * rect.width, rect.top + rect.height / 2);
					pointer(handle, "pointerup", rect.left + toX * rect.width, rect.top + rect.height / 2);
				},
				wait = function (ms) {
					return new Promise(function (resolve) {
						setTimeout(resolve, ms);
					});
				};

			requests = [];
			page.find(".site-map-edit").trigger("click");
			drag(0.2);
			return wait(OSApp.SiteMap.Constants.pinSaveDelay + 200).then(function () {
				assert.lengthOf(requestsTo("/cmp"), 0);
				page.find(".site-map-cancel").trigger("click");
				return wait(OSApp.SiteMap.Constants.pinSaveDelay + 200);
			}).then(function () {
				assert.lengthOf(requestsTo("/cmp"), 0);
				assert.deepEqual(remote.pins, { 0: [5000, 5000] });

				page.find(".site-map-edit").trigger("click");
				drag(0.2);
				page.find(".site-map-edit").trigger("click");
				return wait(300);
			}).then(function () {
				assert.lengthOf(requestsTo("/cmp"), 1);
				assert.isBelow(remote.pins[0][0], 3000);

				// Confirmed once the controller has it
				assert.isTrue(OSApp.Errors.showError.calledWith("Settings have been saved"));
			});
		}).finally(function () {
			OSApp.SiteMap.setHomeView("cards");
		});
	});

	it("should restore drawings from a backup", function () {
		installController({ rev: 3 });

		return new Promise(function (resolve) {
			OSApp.SiteMap.restoreBackupData({
				pins: {},
				drawings: { 0: [{ type: "drip", pts: [[0.1, 0.1], [0.2, 0.2]] }], 999: [{ type: "heads", pts: [[0.5, 0.5]] }] }
			}, resolve);
		}).then(function () {
			assert.equal(remote.drawings, "d,0,1000,1000,2000,2000\n");
		});
	});

	it("should show changes saved on another device", function (done) {
		installController({ rev: 1, pins: { 0: [5000, 5000] }, image: jpeg() });

		openHomeMap().then(function () {
			setTimeout(function () {
				try {
					var page = $("#sprinklers .site-map-view");
					assert.equal(page.find(".site-map-pin").attr("data-sids"), "0");

					// Another device moves the pins
					remote.pins = { 1: [1000, 1000] };
					remote.rev++;
					OSApp.currentSession.controller.options.smap = remote.rev;
					$("html").trigger("datarefresh");

					setTimeout(function () {
						try {
							assert.equal(page.find(".site-map-pin").attr("data-sids"), "1");
							OSApp.SiteMap.setHomeView("cards");
							done();
						} catch (error) {
							done(error);
						}
					}, 100);
				} catch (error) {
					done(error);
				}
			}, 200);
		});
	});
});
