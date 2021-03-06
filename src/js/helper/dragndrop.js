($ => {
    "use strict";

    /**
     * @requires helper: model, i18n, entry, overlay, toggle, list, contextmenu, tooltip, search, bookmark
     * @param {object} ext
     * @constructor
     */
    $.DragDropHelper = function (ext) {

        let sidebarPos = null;
        let oldAboveElm = null;
        let oldTopVal = 0;
        let dirOpenTimeout = null;

        let edgeScroll = {
            running: false,
            posY: null,
            previousDelta: 0,
            fpsLimit: 30
        };

        /**
         * Initializes the events for the drag n drop functionality
         *
         * @returns {Promise}
         */
        this.init = async () => {
            sidebarPos = ext.helper.model.getData("b/sidebarPosition");
            initEvents();
            initExternalDragDropEvents();
        };

        /**
         * Cancels the dragging and resets the position of the dragged element
         */
        this.cancel = () => {
            let draggedElm = ext.elm.iframeBody.children("a." + $.cl.drag.helper);
            let dragInitialElm = ext.elm.bookmarkBox.all.find("li." + $.cl.drag.dragInitial);
            let entryElm = draggedElm.data("elm");

            if (entryElm) {
                let elm = entryElm.children("a");
                entryElm.insertAfter(dragInitialElm).removeClass($.cl.drag.isDragged);
                trackEvent(elm, {type: "end", cancel: true});
            }

            dragInitialElm.remove();
            draggedElm.remove();
            ext.elm.iframeBody.removeClass([$.cl.drag.isDragged, $.cl.drag.cancel]);

            $.delay(500).then(() => {
                ext.helper.toggle.removeSidebarHoverClass();
            });
        };

        /**
         * Checks if the dragged element is outside of the sidebar, so the mouseup will cause an abort and not a repositioning
         *
         * @param {jsu|int} elm
         * @returns {boolean}
         */
        let isDraggedElementOutside = (elm) => {
            let offset = 0;

            if (typeof elm === "object") {
                let boundClientRect = elm[0].getBoundingClientRect();
                offset = boundClientRect.left;
            } else {
                offset = +elm;
            }

            if (sidebarPos === "right") {
                offset = window.innerWidth - offset;
            }

            if (typeof elm === "object") {
                return elm.realWidth() * 0.6 + offset > ext.elm.sidebar.realWidth();
            } else {
                return offset > ext.elm.sidebar.realWidth();
            }
        };

        /**
         * Initialises the eventhandler for external elements beeing dragged into the sidebar (e.g. a link, an image, ...)
         *
         * @returns {Promise}
         */
        let initExternalDragDropEvents = async () => {
            ext.elm.iframeBody.on("dragenter", () => {
                ext.helper.contextmenu.close();
                ext.helper.tooltip.close();
                ext.elm.iframeBody.addClass($.cl.drag.isDragged);
                ext.helper.toggle.addSidebarHoverClass();
                trackEvent("selection", {type: "start"});

                if (!edgeScroll.running) {
                    window.requestAnimationFrame(edgeScrolling);
                }
            }).on("drop dragend", (e) => {
                e.preventDefault();
                e.stopPropagation();
                edgeScroll.posY = null;

                if (ext.elm.iframeBody.hasClass($.cl.drag.isDragged)) { // something has been dragged
                    if (!isDraggedElementOutside(e.pageX) && ext.helper.search.isResultsVisible() === false) { // only proceed if mouse position is in the sidebar and the active view are not the search results
                        let entryPlaceholder = ext.elm.bookmarkBox.all.find("li." + $.cl.drag.isDragged).eq(0);

                        if (entryPlaceholder && entryPlaceholder.length() > 0) {
                            let url = e.dataTransfer.getData("URL");
                            let title = e.dataTransfer.getData("text/plain");

                            if (location.href === url) {
                                title = $(document).find("head > title").eq(0).text();
                            } else if (title === url) {
                                let html = e.dataTransfer.getData("text/html");

                                if (html && html.length > 0) {
                                    title = $("<div />").html(html).text();
                                } else {
                                    title = "";
                                }
                            }

                            trackEvent("selection", {type: "end"});

                            ext.helper.overlay.create("add", ext.helper.i18n.get("contextmenu_add"), {
                                values: {
                                    index: entryPlaceholder.prevAll("li").length(),
                                    parentId: entryPlaceholder.parent("ul").prev("a").attr($.attr.id),
                                    title: title,
                                    url: url
                                }
                            });
                        }
                    } else {
                        trackEvent("selection", {type: "end", cancel: true});
                    }

                    ext.elm.iframeBody.removeClass([$.cl.drag.isDragged, $.cl.drag.cancel]);
                    ext.helper.toggle.removeSidebarHoverClass();
                }
            });
        };

        /**
         * Returns the type of the element which is dragged
         *
         * @param {jsu|string} elm
         */
        let getDragType = (elm) => {
            let type = "bookmark";

            if (elm === "selection") { // element is text
                type = elm;
            } else if (elm.data("type")) { // element type is cached in data obj
                type = elm.data("type");
            } else { // determine type of given element
                if (elm.hasClass($.cl.sidebar.bookmarkDir)) {
                    type = "directory";
                } else if (elm.parents("div." + $.cl.sidebar.entryPinned).length() > 0) {
                    type = "pinned";
                }

                elm.data("type", type);
            }

            return type;
        };

        /**
         * Tracks that an element is beeing dragged (no longer dragged)
         *
         * @param {jsu|string} elm
         * @param {object} opts
         */
        let trackEvent = (elm, opts = {}) => {
            let label = null;

            if (opts.type === "end") {
                label = opts.cancel ? "cancel" : "dragend";
            } else if (opts.type === "start") {
                label = "dragstart";
            }

            if (label) {
                ext.helper.model.call("trackEvent", {
                    category: "dragndrop",
                    action: getDragType(elm),
                    label: label
                });
            }
        };

        /**
         * Start dragging an element (bookmark or directory)
         *
         * @param {Element} node
         * @param {int} x
         * @param {int} y
         */
        let dragstart = (node, x, y) => {
            ext.helper.contextmenu.close();
            ext.helper.tooltip.close();

            let elm = $(node).parent("a").removeClass($.cl.sidebar.dirOpened);
            let data = ext.helper.entry.getDataById(elm.attr($.attr.id));

            if (data === null) {
                return false;
            }

            let elmParent = elm.parent("li");
            let parentTrigger = elmParent.parent("ul").prev("a");

            ext.elm.iframeBody.addClass($.cl.drag.isDragged);
            elmParent.clone().addClass($.cl.drag.dragInitial).insertAfter(elmParent);

            let helper = elm.clone().appendTo(ext.elm.iframeBody);
            let boundClientRect = elm[0].getBoundingClientRect();


            let index = 0;
            elmParent.prevAll("li").forEach((entry) => {
                if (!$(entry).hasClass($.cl.drag.dragInitial)) {
                    index++;
                }
            });

            helper.removeAttr("title").css({
                top: boundClientRect.top + "px",
                left: boundClientRect.left + "px",
                width: elm.realWidth() + "px"
            }).data({
                elm: elmParent,
                isDir: !!(data.isDir),
                parentId: parentTrigger.length() > 0 ? parentTrigger.attr($.attr.id) : null,
                index: index,
                startPos: {
                    top: y - boundClientRect.top,
                    left: x - boundClientRect.left
                }
            }).addClass($.cl.drag.helper);

            elmParent.addClass($.cl.drag.isDragged);
            trackEvent(elm, {type: "start"});

            if (!edgeScroll.running) {
                window.requestAnimationFrame(edgeScrolling);
            }
        };

        /**
         * Scrolls the bookmark list automatically when the user drags an element near the top or bottom of the list
         *
         * @param {int} currentDelta
         */
        let edgeScrolling = (currentDelta) => {
            window.requestAnimationFrame(edgeScrolling);
            let delta = currentDelta - edgeScroll.previousDelta;

            if (edgeScroll.fpsLimit && delta < 1000 / edgeScroll.fpsLimit) {
                return;
            }

            if (edgeScroll.posY !== null) {
                let bookmarkBoxTopOffset = ext.elm.bookmarkBox.all[0].offsetTop;
                let bookmarkBoxHeight = ext.elm.bookmarkBox.all[0].offsetHeight;
                let scrollPos = ext.helper.scroll.getScrollPos(ext.elm.bookmarkBox.all);
                let newScrollPos = null;

                if (edgeScroll.posY - bookmarkBoxTopOffset < 60) {
                    newScrollPos = scrollPos - Math.pow((50 - edgeScroll.posY + bookmarkBoxTopOffset) / 10, 2);
                } else if (edgeScroll.posY + 60 > bookmarkBoxHeight) {
                    newScrollPos = scrollPos + Math.pow((edgeScroll.posY + 50 - bookmarkBoxHeight) / 10, 2);
                }

                if (newScrollPos) {
                    ext.helper.scroll.setScrollPos(ext.elm.bookmarkBox.all, newScrollPos);
                }
            }

            edgeScroll.previousDelta = currentDelta;
        };

        /**
         * Stop dragging an element (bookmark or directory)
         */
        let dragend = () => {
            clearDirOpenTimeout();

            let draggedElm = ext.elm.iframeBody.children("a." + $.cl.drag.helper);
            let dragInitialElm = ext.elm.bookmarkBox.all.find("li." + $.cl.drag.dragInitial);
            let entryElm = draggedElm.data("elm");
            let elm = entryElm.children("a");
            let type = getDragType(elm);

            if (isDraggedElementOutside(draggedElm)) {// cancel drop if mouse position is outside the sidebar
                this.cancel();
            } else { // animate the helper back to the new position and save it
                draggedElm.addClass($.cl.drag.snap);

                let parentId = entryElm.parent("ul").prev("a").attr($.attr.id);
                let index = 0;

                entryElm.prevAll("li").forEach((el) => {
                    if (el !== dragInitialElm) {
                        index++;
                    }
                });

                if (type === "pinned") { // save position of pinned entry
                    ext.helper.bookmark.reorderPinnedEntries({
                        id: entryElm.children("a").attr($.attr.id),
                        prevId: entryElm.prev("li").children("a").attr($.attr.id)
                    });
                } else { // save bookmark/directory position
                    ext.helper.model.call("moveBookmark", {
                        id: entryElm.children("a").attr($.attr.id),
                        parentId: parentId,
                        index: index
                    });
                }

                trackEvent(elm, {type: "end"});
                ext.elm.iframeBody.removeClass($.cl.drag.isDragged);

                $.delay().then(() => {
                    let boundClientRect = entryElm[0].getBoundingClientRect();

                    draggedElm.css({
                        top: boundClientRect.top + "px",
                        left: boundClientRect.left + "px"
                    });

                    return $.delay(200);
                }).then(() => {
                    entryElm.removeClass($.cl.drag.isDragged);
                    dragInitialElm.remove();
                    draggedElm.remove();

                    return $.delay(300);
                }).then(() => {
                    ext.helper.toggle.removeSidebarHoverClass();
                });
            }
        };

        /**
         * Clears the directory open timeout
         *
         * @param {jsu} checkElm
         */
        let clearDirOpenTimeout = (checkElm = null) => {
            if (dirOpenTimeout !== null && (checkElm === null || dirOpenTimeout.id !== checkElm.attr($.attr.id))) {
                dirOpenTimeout.elm.removeClass($.cl.drag.dragHover);
                clearTimeout(dirOpenTimeout.instance);
                dirOpenTimeout = null;
            }
        };

        /**
         * Drag an element (bookmark or directory or something external (a link, an image, ...))
         *
         * @param {string} eventType
         * @param {int} x
         * @param {int} y
         */
        let dragmove = (eventType, x, y) => {
            let draggedElm = null;
            let bookmarkElm = null;
            let topVal = 0;
            let leftVal = 0;

            if (eventType === "dragover") { // dragging anything (e.g. a link, an image, ...)
                topVal = y - 20;
                leftVal = x;
                if (topVal === oldTopVal) {
                    return false;
                }
                oldTopVal = topVal;
                ext.elm.bookmarkBox.all.find("li." + $.cl.drag.isDragged).remove();
                bookmarkElm = $("<li />").html("<a>&nbsp;</a>").addClass($.cl.drag.isDragged);
            } else { // dragging bookmark or directory
                draggedElm = ext.elm.iframeBody.children("a." + $.cl.drag.helper);
                let startPos = draggedElm.data("startPos");
                topVal = y - startPos.top;
                leftVal = x - startPos.left;

                draggedElm.css({
                    top: topVal + "px",
                    left: leftVal + "px"
                });

                bookmarkElm = draggedElm.data("elm");
            }

            if (isDraggedElementOutside(draggedElm || leftVal)) { // dragged outside the sidebar -> mouseup will cancel
                clearDirOpenTimeout();
                ext.elm.iframeBody.addClass($.cl.drag.cancel);
                return false;
            } else {
                ext.elm.iframeBody.removeClass($.cl.drag.cancel);
            }

            let newAboveElm = {elm: null};
            let type = getDragType(bookmarkElm.children("a"));
            let elmLists = null;

            if (type === "pinned") {
                elmLists = [ext.elm.pinnedBox.find("> ul > li")];
            } else {
                edgeScroll.posY = y;
                elmLists = [
                    ext.elm.bookmarkBox.all.find("a." + $.cl.sidebar.dirOpened + " + ul > li"),
                    ext.elm.bookmarkBox.all.find("> ul > li > a." + $.cl.sidebar.dirOpened).parent("li")
                ];
            }

            elmLists.some((list) => {
                list && list.forEach((node) => { // determine the element which is above the current drag position
                    let elmObj = $(node);

                    if (elmObj[0] !== bookmarkElm[0] && !elmObj.hasClass($.cl.drag.dragInitial)) {
                        let boundClientRect = elmObj[0].getBoundingClientRect();
                        let diff = topVal - boundClientRect.top;

                        if (boundClientRect.top > topVal) {
                            return false;
                        } else if (newAboveElm.elm === null || newAboveElm.diff > diff) {
                            newAboveElm = {elm: elmObj, height: elmObj[0].offsetHeight, diff: diff};
                        }
                    }
                });
            });

            if (newAboveElm.elm && newAboveElm.elm !== oldAboveElm) {
                oldAboveElm = newAboveElm.elm;
                let newAboveLink = newAboveElm.elm.children("a").eq(0);
                let aboveIsDir = newAboveLink.hasClass($.cl.sidebar.bookmarkDir);
                let hoverPosPercentage = newAboveElm.diff / newAboveElm.height * 100;

                clearDirOpenTimeout(newAboveLink);

                if (newAboveElm.elm.nextAll("li:not(." + $.cl.drag.isDragged + ")").length() === 0 && hoverPosPercentage > 80) { // drag position is below the last element of a directory -> placeholder under the current directory
                    let elm = bookmarkElm.insertAfter(newAboveElm.elm.parents("li").eq(0));
                    if (draggedElm) {
                        draggedElm.data("elm", elm);
                    }
                } else if (aboveIsDir && hoverPosPercentage < 50) { // directory is hovered
                    if (newAboveLink.hasClass($.cl.sidebar.dirOpened)) { // opened directory
                        let elm = bookmarkElm.prependTo(newAboveLink.next("ul"));
                        if (draggedElm) {
                            draggedElm.data("elm", elm);
                        }
                    } else if (!newAboveLink.hasClass($.cl.sidebar.dirAnimated)) { // closed directory
                        if (dirOpenTimeout === null) {
                            dirOpenTimeout = {
                                id: newAboveLink.attr($.attr.id),
                                elm: newAboveLink.addClass($.cl.drag.dragHover)
                            };

                            dirOpenTimeout.instance = setTimeout(() => { // open closed directory after short delay -> possibility for user to cancel timeout
                                ext.helper.list.toggleBookmarkDir(newAboveLink);
                            }, 1000);
                        }
                    } else if (newAboveLink.next("ul").length() === 0) { // empty directory
                        newAboveLink.addClass($.cl.sidebar.dirOpened);
                        $("<ul />").insertAfter(newAboveLink);
                    }
                } else { // drag position is below a bookmark
                    clearDirOpenTimeout();

                    let elm = bookmarkElm.insertAfter(newAboveElm.elm);
                    if (draggedElm) {
                        draggedElm.data("elm", elm);
                    }
                }
            } else if (type === "pinned") { // pinned entry -> no element above -> index = 0
                let elm = bookmarkElm.prependTo(ext.elm.pinnedBox.children("ul"));
                if (draggedElm) {
                    draggedElm.data("elm", elm);
                }
            }
        };

        /**
         * Initializes the eventhandlers for the dragDrop functionality of the bookmarks
         *
         * @returns {Promise}
         */
        let initEvents = async () => {

            ext.elm.bookmarkBox.all.on("mousedown", "span." + $.cl.drag.trigger, (e) => { // drag start
                ext.helper.toggle.addSidebarHoverClass();
                dragstart(e.currentTarget, e.pageX, e.pageY);
                dragmove(e.type, e.pageX, e.pageY);
            });

            ext.elm.iframeBody.on("mouseup", (e) => { // drag end
                edgeScroll.posY = null;
                if (ext.elm.iframeBody.hasClass($.cl.drag.isDragged)) { // bookmark has been dragged
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.which === 1) { // only perform rearrangement of elements when the left mouse button is released
                        dragend();
                    } else { // cancel drag
                        $.delay(0).then(() => {
                            this.cancel();
                        });
                    }
                }
            });

            ext.elm.iframeBody.on("wheel", (e) => { // scroll the bookmark list
                if (ext.elm.iframeBody.hasClass($.cl.drag.isDragged)) {
                    e.preventDefault();
                    e.stopPropagation();

                    let scrollPos = ext.elm.bookmarkBox.all[0].scrollTop;
                    ext.helper.scroll.setScrollPos(ext.elm.bookmarkBox.all, scrollPos - e.wheelDelta, 300);
                }
            });

            ext.elm.iframeBody.on("mousemove dragover", (e) => { // drag move
                if (ext.elm.iframeBody.hasClass($.cl.drag.isDragged) && e.which === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    dragmove(e.type, e.pageX, e.pageY);
                }
            });

            ext.elm.iframeBody.on("contextmenu", "a." + $.cl.drag.helper, (e) => { // disable right click or the drag handle
                e.preventDefault();
                e.stopPropagation();
            });
        };
    };

})(jsu);
