 (() => new EventSource("/esbuild").onmessage = () => location.reload())();
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/xterm@5.3.0/node_modules/xterm/lib/xterm.js
var require_xterm = __commonJS({
  "../../node_modules/.pnpm/xterm@5.3.0/node_modules/xterm/lib/xterm.js"(exports, module2) {
    !function(e2, t5) {
      if ("object" == typeof exports && "object" == typeof module2)
        module2.exports = t5();
      else if ("function" == typeof define && define.amd)
        define([], t5);
      else {
        var i7 = t5();
        for (var s10 in i7)
          ("object" == typeof exports ? exports : e2)[s10] = i7[s10];
      }
    }(self, () => (() => {
      "use strict";
      var e2 = { 4567: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.AccessibilityManager = void 0;
        const n8 = i8(9042), o5 = i8(6114), a8 = i8(9924), h3 = i8(844), c12 = i8(5596), l9 = i8(4725), d7 = i8(3656);
        let _4 = t6.AccessibilityManager = class extends h3.Disposable {
          constructor(e4, t7) {
            super(), this._terminal = e4, this._renderService = t7, this._liveRegionLineCount = 0, this._charsToConsume = [], this._charsToAnnounce = "", this._accessibilityContainer = document.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = document.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
            for (let e5 = 0; e5 < this._terminal.rows; e5++)
              this._rowElements[e5] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e5]);
            if (this._topBoundaryFocusListener = (e5) => this._handleBoundaryFocus(e5, 0), this._bottomBoundaryFocusListener = (e5) => this._handleBoundaryFocus(e5, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions(), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = document.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this.register(new a8.TimeBasedDebouncer(this._renderRows.bind(this))), !this._terminal.element)
              throw new Error("Cannot enable accessibility before Terminal.open");
            this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this.register(this._terminal.onResize((e5) => this._handleResize(e5.rows))), this.register(this._terminal.onRender((e5) => this._refreshRows(e5.start, e5.end))), this.register(this._terminal.onScroll(() => this._refreshRows())), this.register(this._terminal.onA11yChar((e5) => this._handleChar(e5))), this.register(this._terminal.onLineFeed(() => this._handleChar("\n"))), this.register(this._terminal.onA11yTab((e5) => this._handleTab(e5))), this.register(this._terminal.onKey((e5) => this._handleKey(e5.key))), this.register(this._terminal.onBlur(() => this._clearLiveRegion())), this.register(this._renderService.onDimensionsChange(() => this._refreshRowsDimensions())), this._screenDprMonitor = new c12.ScreenDprMonitor(window), this.register(this._screenDprMonitor), this._screenDprMonitor.setListener(() => this._refreshRowsDimensions()), this.register((0, d7.addDisposableDomListener)(window, "resize", () => this._refreshRowsDimensions())), this._refreshRows(), this.register((0, h3.toDisposable)(() => {
              this._accessibilityContainer.remove(), this._rowElements.length = 0;
            }));
          }
          _handleTab(e4) {
            for (let t7 = 0; t7 < e4; t7++)
              this._handleChar(" ");
          }
          _handleChar(e4) {
            this._liveRegionLineCount < 21 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e4 && (this._charsToAnnounce += e4) : this._charsToAnnounce += e4, "\n" === e4 && (this._liveRegionLineCount++, 21 === this._liveRegionLineCount && (this._liveRegion.textContent += n8.tooMuchOutput)), o5.isMac && this._liveRegion.textContent && this._liveRegion.textContent.length > 0 && !this._liveRegion.parentNode && setTimeout(() => {
              this._accessibilityContainer.appendChild(this._liveRegion);
            }, 0));
          }
          _clearLiveRegion() {
            this._liveRegion.textContent = "", this._liveRegionLineCount = 0, o5.isMac && this._liveRegion.remove();
          }
          _handleKey(e4) {
            this._clearLiveRegion(), /\p{Control}/u.test(e4) || this._charsToConsume.push(e4);
          }
          _refreshRows(e4, t7) {
            this._liveRegionDebouncer.refresh(e4, t7, this._terminal.rows);
          }
          _renderRows(e4, t7) {
            const i9 = this._terminal.buffer, s12 = i9.lines.length.toString();
            for (let r5 = e4; r5 <= t7; r5++) {
              const e5 = i9.translateBufferLineToString(i9.ydisp + r5, true), t8 = (i9.ydisp + r5 + 1).toString(), n9 = this._rowElements[r5];
              n9 && (0 === e5.length ? n9.innerText = "\xA0" : n9.textContent = e5, n9.setAttribute("aria-posinset", t8), n9.setAttribute("aria-setsize", s12));
            }
            this._announceCharacters();
          }
          _announceCharacters() {
            0 !== this._charsToAnnounce.length && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
          }
          _handleBoundaryFocus(e4, t7) {
            const i9 = e4.target, s12 = this._rowElements[0 === t7 ? 1 : this._rowElements.length - 2];
            if (i9.getAttribute("aria-posinset") === (0 === t7 ? "1" : `${this._terminal.buffer.lines.length}`))
              return;
            if (e4.relatedTarget !== s12)
              return;
            let r5, n9;
            if (0 === t7 ? (r5 = i9, n9 = this._rowElements.pop(), this._rowContainer.removeChild(n9)) : (r5 = this._rowElements.shift(), n9 = i9, this._rowContainer.removeChild(r5)), r5.removeEventListener("focus", this._topBoundaryFocusListener), n9.removeEventListener("focus", this._bottomBoundaryFocusListener), 0 === t7) {
              const e5 = this._createAccessibilityTreeNode();
              this._rowElements.unshift(e5), this._rowContainer.insertAdjacentElement("afterbegin", e5);
            } else {
              const e5 = this._createAccessibilityTreeNode();
              this._rowElements.push(e5), this._rowContainer.appendChild(e5);
            }
            this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(0 === t7 ? -1 : 1), this._rowElements[0 === t7 ? 1 : this._rowElements.length - 2].focus(), e4.preventDefault(), e4.stopImmediatePropagation();
          }
          _handleResize(e4) {
            this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
            for (let e5 = this._rowContainer.children.length; e5 < this._terminal.rows; e5++)
              this._rowElements[e5] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e5]);
            for (; this._rowElements.length > e4; )
              this._rowContainer.removeChild(this._rowElements.pop());
            this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
          }
          _createAccessibilityTreeNode() {
            const e4 = document.createElement("div");
            return e4.setAttribute("role", "listitem"), e4.tabIndex = -1, this._refreshRowDimensions(e4), e4;
          }
          _refreshRowsDimensions() {
            if (this._renderService.dimensions.css.cell.height) {
              this._accessibilityContainer.style.width = `${this._renderService.dimensions.css.canvas.width}px`, this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
              for (let e4 = 0; e4 < this._terminal.rows; e4++)
                this._refreshRowDimensions(this._rowElements[e4]);
            }
          }
          _refreshRowDimensions(e4) {
            e4.style.height = `${this._renderService.dimensions.css.cell.height}px`;
          }
        };
        t6.AccessibilityManager = _4 = s11([r4(1, l9.IRenderService)], _4);
      }, 3614: (e3, t6) => {
        function i8(e4) {
          return e4.replace(/\r?\n/g, "\r");
        }
        function s11(e4, t7) {
          return t7 ? "\x1B[200~" + e4 + "\x1B[201~" : e4;
        }
        function r4(e4, t7, r5, n9) {
          e4 = s11(e4 = i8(e4), r5.decPrivateModes.bracketedPasteMode && true !== n9.rawOptions.ignoreBracketedPasteMode), r5.triggerDataEvent(e4, true), t7.value = "";
        }
        function n8(e4, t7, i9) {
          const s12 = i9.getBoundingClientRect(), r5 = e4.clientX - s12.left - 10, n9 = e4.clientY - s12.top - 10;
          t7.style.width = "20px", t7.style.height = "20px", t7.style.left = `${r5}px`, t7.style.top = `${n9}px`, t7.style.zIndex = "1000", t7.focus();
        }
        Object.defineProperty(t6, "__esModule", { value: true }), t6.rightClickHandler = t6.moveTextAreaUnderMouseCursor = t6.paste = t6.handlePasteEvent = t6.copyHandler = t6.bracketTextForPaste = t6.prepareTextForTerminal = void 0, t6.prepareTextForTerminal = i8, t6.bracketTextForPaste = s11, t6.copyHandler = function(e4, t7) {
          e4.clipboardData && e4.clipboardData.setData("text/plain", t7.selectionText), e4.preventDefault();
        }, t6.handlePasteEvent = function(e4, t7, i9, s12) {
          e4.stopPropagation(), e4.clipboardData && r4(e4.clipboardData.getData("text/plain"), t7, i9, s12);
        }, t6.paste = r4, t6.moveTextAreaUnderMouseCursor = n8, t6.rightClickHandler = function(e4, t7, i9, s12, r5) {
          n8(e4, t7, i9), r5 && s12.rightClickSelect(e4), t7.value = s12.selectionText, t7.select();
        };
      }, 7239: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ColorContrastCache = void 0;
        const s11 = i8(1505);
        t6.ColorContrastCache = class {
          constructor() {
            this._color = new s11.TwoKeyMap(), this._css = new s11.TwoKeyMap();
          }
          setCss(e4, t7, i9) {
            this._css.set(e4, t7, i9);
          }
          getCss(e4, t7) {
            return this._css.get(e4, t7);
          }
          setColor(e4, t7, i9) {
            this._color.set(e4, t7, i9);
          }
          getColor(e4, t7) {
            return this._color.get(e4, t7);
          }
          clear() {
            this._color.clear(), this._css.clear();
          }
        };
      }, 3656: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.addDisposableDomListener = void 0, t6.addDisposableDomListener = function(e4, t7, i8, s11) {
          e4.addEventListener(t7, i8, s11);
          let r4 = false;
          return { dispose: () => {
            r4 || (r4 = true, e4.removeEventListener(t7, i8, s11));
          } };
        };
      }, 6465: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Linkifier2 = void 0;
        const n8 = i8(3656), o5 = i8(8460), a8 = i8(844), h3 = i8(2585);
        let c12 = t6.Linkifier2 = class extends a8.Disposable {
          get currentLink() {
            return this._currentLink;
          }
          constructor(e4) {
            super(), this._bufferService = e4, this._linkProviders = [], this._linkCacheDisposables = [], this._isMouseOut = true, this._wasResized = false, this._activeLine = -1, this._onShowLinkUnderline = this.register(new o5.EventEmitter()), this.onShowLinkUnderline = this._onShowLinkUnderline.event, this._onHideLinkUnderline = this.register(new o5.EventEmitter()), this.onHideLinkUnderline = this._onHideLinkUnderline.event, this.register((0, a8.getDisposeArrayDisposable)(this._linkCacheDisposables)), this.register((0, a8.toDisposable)(() => {
              this._lastMouseEvent = void 0;
            })), this.register(this._bufferService.onResize(() => {
              this._clearCurrentLink(), this._wasResized = true;
            }));
          }
          registerLinkProvider(e4) {
            return this._linkProviders.push(e4), { dispose: () => {
              const t7 = this._linkProviders.indexOf(e4);
              -1 !== t7 && this._linkProviders.splice(t7, 1);
            } };
          }
          attachToDom(e4, t7, i9) {
            this._element = e4, this._mouseService = t7, this._renderService = i9, this.register((0, n8.addDisposableDomListener)(this._element, "mouseleave", () => {
              this._isMouseOut = true, this._clearCurrentLink();
            })), this.register((0, n8.addDisposableDomListener)(this._element, "mousemove", this._handleMouseMove.bind(this))), this.register((0, n8.addDisposableDomListener)(this._element, "mousedown", this._handleMouseDown.bind(this))), this.register((0, n8.addDisposableDomListener)(this._element, "mouseup", this._handleMouseUp.bind(this)));
          }
          _handleMouseMove(e4) {
            if (this._lastMouseEvent = e4, !this._element || !this._mouseService)
              return;
            const t7 = this._positionFromMouseEvent(e4, this._element, this._mouseService);
            if (!t7)
              return;
            this._isMouseOut = false;
            const i9 = e4.composedPath();
            for (let e5 = 0; e5 < i9.length; e5++) {
              const t8 = i9[e5];
              if (t8.classList.contains("xterm"))
                break;
              if (t8.classList.contains("xterm-hover"))
                return;
            }
            this._lastBufferCell && t7.x === this._lastBufferCell.x && t7.y === this._lastBufferCell.y || (this._handleHover(t7), this._lastBufferCell = t7);
          }
          _handleHover(e4) {
            if (this._activeLine !== e4.y || this._wasResized)
              return this._clearCurrentLink(), this._askForLink(e4, false), void (this._wasResized = false);
            this._currentLink && this._linkAtPosition(this._currentLink.link, e4) || (this._clearCurrentLink(), this._askForLink(e4, true));
          }
          _askForLink(e4, t7) {
            var i9, s12;
            this._activeProviderReplies && t7 || (null === (i9 = this._activeProviderReplies) || void 0 === i9 || i9.forEach((e5) => {
              null == e5 || e5.forEach((e6) => {
                e6.link.dispose && e6.link.dispose();
              });
            }), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e4.y);
            let r5 = false;
            for (const [i10, n9] of this._linkProviders.entries())
              t7 ? (null === (s12 = this._activeProviderReplies) || void 0 === s12 ? void 0 : s12.get(i10)) && (r5 = this._checkLinkProviderResult(i10, e4, r5)) : n9.provideLinks(e4.y, (t8) => {
                var s13, n10;
                if (this._isMouseOut)
                  return;
                const o6 = null == t8 ? void 0 : t8.map((e5) => ({ link: e5 }));
                null === (s13 = this._activeProviderReplies) || void 0 === s13 || s13.set(i10, o6), r5 = this._checkLinkProviderResult(i10, e4, r5), (null === (n10 = this._activeProviderReplies) || void 0 === n10 ? void 0 : n10.size) === this._linkProviders.length && this._removeIntersectingLinks(e4.y, this._activeProviderReplies);
              });
          }
          _removeIntersectingLinks(e4, t7) {
            const i9 = /* @__PURE__ */ new Set();
            for (let s12 = 0; s12 < t7.size; s12++) {
              const r5 = t7.get(s12);
              if (r5)
                for (let t8 = 0; t8 < r5.length; t8++) {
                  const s13 = r5[t8], n9 = s13.link.range.start.y < e4 ? 0 : s13.link.range.start.x, o6 = s13.link.range.end.y > e4 ? this._bufferService.cols : s13.link.range.end.x;
                  for (let e5 = n9; e5 <= o6; e5++) {
                    if (i9.has(e5)) {
                      r5.splice(t8--, 1);
                      break;
                    }
                    i9.add(e5);
                  }
                }
            }
          }
          _checkLinkProviderResult(e4, t7, i9) {
            var s12;
            if (!this._activeProviderReplies)
              return i9;
            const r5 = this._activeProviderReplies.get(e4);
            let n9 = false;
            for (let t8 = 0; t8 < e4; t8++)
              this._activeProviderReplies.has(t8) && !this._activeProviderReplies.get(t8) || (n9 = true);
            if (!n9 && r5) {
              const e5 = r5.find((e6) => this._linkAtPosition(e6.link, t7));
              e5 && (i9 = true, this._handleNewLink(e5));
            }
            if (this._activeProviderReplies.size === this._linkProviders.length && !i9)
              for (let e5 = 0; e5 < this._activeProviderReplies.size; e5++) {
                const r6 = null === (s12 = this._activeProviderReplies.get(e5)) || void 0 === s12 ? void 0 : s12.find((e6) => this._linkAtPosition(e6.link, t7));
                if (r6) {
                  i9 = true, this._handleNewLink(r6);
                  break;
                }
              }
            return i9;
          }
          _handleMouseDown() {
            this._mouseDownLink = this._currentLink;
          }
          _handleMouseUp(e4) {
            if (!this._element || !this._mouseService || !this._currentLink)
              return;
            const t7 = this._positionFromMouseEvent(e4, this._element, this._mouseService);
            t7 && this._mouseDownLink === this._currentLink && this._linkAtPosition(this._currentLink.link, t7) && this._currentLink.link.activate(e4, this._currentLink.link.text);
          }
          _clearCurrentLink(e4, t7) {
            this._element && this._currentLink && this._lastMouseEvent && (!e4 || !t7 || this._currentLink.link.range.start.y >= e4 && this._currentLink.link.range.end.y <= t7) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, (0, a8.disposeArray)(this._linkCacheDisposables));
          }
          _handleNewLink(e4) {
            if (!this._element || !this._lastMouseEvent || !this._mouseService)
              return;
            const t7 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
            t7 && this._linkAtPosition(e4.link, t7) && (this._currentLink = e4, this._currentLink.state = { decorations: { underline: void 0 === e4.link.decorations || e4.link.decorations.underline, pointerCursor: void 0 === e4.link.decorations || e4.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e4.link, this._lastMouseEvent), e4.link.decorations = {}, Object.defineProperties(e4.link.decorations, { pointerCursor: { get: () => {
              var e5, t8;
              return null === (t8 = null === (e5 = this._currentLink) || void 0 === e5 ? void 0 : e5.state) || void 0 === t8 ? void 0 : t8.decorations.pointerCursor;
            }, set: (e5) => {
              var t8, i9;
              (null === (t8 = this._currentLink) || void 0 === t8 ? void 0 : t8.state) && this._currentLink.state.decorations.pointerCursor !== e5 && (this._currentLink.state.decorations.pointerCursor = e5, this._currentLink.state.isHovered && (null === (i9 = this._element) || void 0 === i9 || i9.classList.toggle("xterm-cursor-pointer", e5)));
            } }, underline: { get: () => {
              var e5, t8;
              return null === (t8 = null === (e5 = this._currentLink) || void 0 === e5 ? void 0 : e5.state) || void 0 === t8 ? void 0 : t8.decorations.underline;
            }, set: (t8) => {
              var i9, s12, r5;
              (null === (i9 = this._currentLink) || void 0 === i9 ? void 0 : i9.state) && (null === (r5 = null === (s12 = this._currentLink) || void 0 === s12 ? void 0 : s12.state) || void 0 === r5 ? void 0 : r5.decorations.underline) !== t8 && (this._currentLink.state.decorations.underline = t8, this._currentLink.state.isHovered && this._fireUnderlineEvent(e4.link, t8));
            } } }), this._renderService && this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((e5) => {
              if (!this._currentLink)
                return;
              const t8 = 0 === e5.start ? 0 : e5.start + 1 + this._bufferService.buffer.ydisp, i9 = this._bufferService.buffer.ydisp + 1 + e5.end;
              if (this._currentLink.link.range.start.y >= t8 && this._currentLink.link.range.end.y <= i9 && (this._clearCurrentLink(t8, i9), this._lastMouseEvent && this._element)) {
                const e6 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
                e6 && this._askForLink(e6, false);
              }
            })));
          }
          _linkHover(e4, t7, i9) {
            var s12;
            (null === (s12 = this._currentLink) || void 0 === s12 ? void 0 : s12.state) && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t7, true), this._currentLink.state.decorations.pointerCursor && e4.classList.add("xterm-cursor-pointer")), t7.hover && t7.hover(i9, t7.text);
          }
          _fireUnderlineEvent(e4, t7) {
            const i9 = e4.range, s12 = this._bufferService.buffer.ydisp, r5 = this._createLinkUnderlineEvent(i9.start.x - 1, i9.start.y - s12 - 1, i9.end.x, i9.end.y - s12 - 1, void 0);
            (t7 ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(r5);
          }
          _linkLeave(e4, t7, i9) {
            var s12;
            (null === (s12 = this._currentLink) || void 0 === s12 ? void 0 : s12.state) && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t7, false), this._currentLink.state.decorations.pointerCursor && e4.classList.remove("xterm-cursor-pointer")), t7.leave && t7.leave(i9, t7.text);
          }
          _linkAtPosition(e4, t7) {
            const i9 = e4.range.start.y * this._bufferService.cols + e4.range.start.x, s12 = e4.range.end.y * this._bufferService.cols + e4.range.end.x, r5 = t7.y * this._bufferService.cols + t7.x;
            return i9 <= r5 && r5 <= s12;
          }
          _positionFromMouseEvent(e4, t7, i9) {
            const s12 = i9.getCoords(e4, t7, this._bufferService.cols, this._bufferService.rows);
            if (s12)
              return { x: s12[0], y: s12[1] + this._bufferService.buffer.ydisp };
          }
          _createLinkUnderlineEvent(e4, t7, i9, s12, r5) {
            return { x1: e4, y1: t7, x2: i9, y2: s12, cols: this._bufferService.cols, fg: r5 };
          }
        };
        t6.Linkifier2 = c12 = s11([r4(0, h3.IBufferService)], c12);
      }, 9042: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.tooMuchOutput = t6.promptLabel = void 0, t6.promptLabel = "Terminal input", t6.tooMuchOutput = "Too much output to announce, navigate to rows manually to read";
      }, 3730: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.OscLinkProvider = void 0;
        const n8 = i8(511), o5 = i8(2585);
        let a8 = t6.OscLinkProvider = class {
          constructor(e4, t7, i9) {
            this._bufferService = e4, this._optionsService = t7, this._oscLinkService = i9;
          }
          provideLinks(e4, t7) {
            var i9;
            const s12 = this._bufferService.buffer.lines.get(e4 - 1);
            if (!s12)
              return void t7(void 0);
            const r5 = [], o6 = this._optionsService.rawOptions.linkHandler, a9 = new n8.CellData(), c12 = s12.getTrimmedLength();
            let l9 = -1, d7 = -1, _4 = false;
            for (let t8 = 0; t8 < c12; t8++)
              if (-1 !== d7 || s12.hasContent(t8)) {
                if (s12.loadCell(t8, a9), a9.hasExtendedAttrs() && a9.extended.urlId) {
                  if (-1 === d7) {
                    d7 = t8, l9 = a9.extended.urlId;
                    continue;
                  }
                  _4 = a9.extended.urlId !== l9;
                } else
                  -1 !== d7 && (_4 = true);
                if (_4 || -1 !== d7 && t8 === c12 - 1) {
                  const s13 = null === (i9 = this._oscLinkService.getLinkData(l9)) || void 0 === i9 ? void 0 : i9.uri;
                  if (s13) {
                    const i10 = { start: { x: d7 + 1, y: e4 }, end: { x: t8 + (_4 || t8 !== c12 - 1 ? 0 : 1), y: e4 } };
                    let n9 = false;
                    if (!(null == o6 ? void 0 : o6.allowNonHttpProtocols))
                      try {
                        const e5 = new URL(s13);
                        ["http:", "https:"].includes(e5.protocol) || (n9 = true);
                      } catch (e5) {
                        n9 = true;
                      }
                    n9 || r5.push({ text: s13, range: i10, activate: (e5, t9) => o6 ? o6.activate(e5, t9, i10) : h3(0, t9), hover: (e5, t9) => {
                      var s14;
                      return null === (s14 = null == o6 ? void 0 : o6.hover) || void 0 === s14 ? void 0 : s14.call(o6, e5, t9, i10);
                    }, leave: (e5, t9) => {
                      var s14;
                      return null === (s14 = null == o6 ? void 0 : o6.leave) || void 0 === s14 ? void 0 : s14.call(o6, e5, t9, i10);
                    } });
                  }
                  _4 = false, a9.hasExtendedAttrs() && a9.extended.urlId ? (d7 = t8, l9 = a9.extended.urlId) : (d7 = -1, l9 = -1);
                }
              }
            t7(r5);
          }
        };
        function h3(e4, t7) {
          if (confirm(`Do you want to navigate to ${t7}?

WARNING: This link could potentially be dangerous`)) {
            const e5 = window.open();
            if (e5) {
              try {
                e5.opener = null;
              } catch (e6) {
              }
              e5.location.href = t7;
            } else
              console.warn("Opening link blocked as opener could not be cleared");
          }
        }
        t6.OscLinkProvider = a8 = s11([r4(0, o5.IBufferService), r4(1, o5.IOptionsService), r4(2, o5.IOscLinkService)], a8);
      }, 6193: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.RenderDebouncer = void 0, t6.RenderDebouncer = class {
          constructor(e4, t7) {
            this._parentWindow = e4, this._renderCallback = t7, this._refreshCallbacks = [];
          }
          dispose() {
            this._animationFrame && (this._parentWindow.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
          }
          addRefreshCallback(e4) {
            return this._refreshCallbacks.push(e4), this._animationFrame || (this._animationFrame = this._parentWindow.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
          }
          refresh(e4, t7, i8) {
            this._rowCount = i8, e4 = void 0 !== e4 ? e4 : 0, t7 = void 0 !== t7 ? t7 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e4) : e4, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t7) : t7, this._animationFrame || (this._animationFrame = this._parentWindow.requestAnimationFrame(() => this._innerRefresh()));
          }
          _innerRefresh() {
            if (this._animationFrame = void 0, void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount)
              return void this._runRefreshCallbacks();
            const e4 = Math.max(this._rowStart, 0), t7 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e4, t7), this._runRefreshCallbacks();
          }
          _runRefreshCallbacks() {
            for (const e4 of this._refreshCallbacks)
              e4(0);
            this._refreshCallbacks = [];
          }
        };
      }, 5596: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ScreenDprMonitor = void 0;
        const s11 = i8(844);
        class r4 extends s11.Disposable {
          constructor(e4) {
            super(), this._parentWindow = e4, this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this.register((0, s11.toDisposable)(() => {
              this.clearListener();
            }));
          }
          setListener(e4) {
            this._listener && this.clearListener(), this._listener = e4, this._outerListener = () => {
              this._listener && (this._listener(this._parentWindow.devicePixelRatio, this._currentDevicePixelRatio), this._updateDpr());
            }, this._updateDpr();
          }
          _updateDpr() {
            var e4;
            this._outerListener && (null === (e4 = this._resolutionMediaMatchList) || void 0 === e4 || e4.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
          }
          clearListener() {
            this._resolutionMediaMatchList && this._listener && this._outerListener && (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._listener = void 0, this._outerListener = void 0);
          }
        }
        t6.ScreenDprMonitor = r4;
      }, 3236: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Terminal = void 0;
        const s11 = i8(3614), r4 = i8(3656), n8 = i8(6465), o5 = i8(9042), a8 = i8(3730), h3 = i8(1680), c12 = i8(3107), l9 = i8(5744), d7 = i8(2950), _4 = i8(1296), u9 = i8(428), f5 = i8(4269), v4 = i8(5114), p5 = i8(8934), g6 = i8(3230), m8 = i8(9312), S2 = i8(4725), C3 = i8(6731), b4 = i8(8055), y4 = i8(8969), w3 = i8(8460), E4 = i8(844), k2 = i8(6114), L2 = i8(8437), D4 = i8(2584), R2 = i8(7399), x3 = i8(5941), A2 = i8(9074), B2 = i8(2585), T4 = i8(5435), M3 = i8(4567), O2 = "undefined" != typeof window ? window.document : null;
        class P2 extends y4.CoreTerminal {
          get onFocus() {
            return this._onFocus.event;
          }
          get onBlur() {
            return this._onBlur.event;
          }
          get onA11yChar() {
            return this._onA11yCharEmitter.event;
          }
          get onA11yTab() {
            return this._onA11yTabEmitter.event;
          }
          get onWillOpen() {
            return this._onWillOpen.event;
          }
          constructor(e4 = {}) {
            super(e4), this.browser = k2, this._keyDownHandled = false, this._keyDownSeen = false, this._keyPressHandled = false, this._unprocessedDeadKey = false, this._accessibilityManager = this.register(new E4.MutableDisposable()), this._onCursorMove = this.register(new w3.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onKey = this.register(new w3.EventEmitter()), this.onKey = this._onKey.event, this._onRender = this.register(new w3.EventEmitter()), this.onRender = this._onRender.event, this._onSelectionChange = this.register(new w3.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onTitleChange = this.register(new w3.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onBell = this.register(new w3.EventEmitter()), this.onBell = this._onBell.event, this._onFocus = this.register(new w3.EventEmitter()), this._onBlur = this.register(new w3.EventEmitter()), this._onA11yCharEmitter = this.register(new w3.EventEmitter()), this._onA11yTabEmitter = this.register(new w3.EventEmitter()), this._onWillOpen = this.register(new w3.EventEmitter()), this._setup(), this.linkifier2 = this.register(this._instantiationService.createInstance(n8.Linkifier2)), this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(a8.OscLinkProvider)), this._decorationService = this._instantiationService.createInstance(A2.DecorationService), this._instantiationService.setService(B2.IDecorationService, this._decorationService), this.register(this._inputHandler.onRequestBell(() => this._onBell.fire())), this.register(this._inputHandler.onRequestRefreshRows((e5, t7) => this.refresh(e5, t7))), this.register(this._inputHandler.onRequestSendFocus(() => this._reportFocus())), this.register(this._inputHandler.onRequestReset(() => this.reset())), this.register(this._inputHandler.onRequestWindowsOptionsReport((e5) => this._reportWindowsOptions(e5))), this.register(this._inputHandler.onColor((e5) => this._handleColorEvent(e5))), this.register((0, w3.forwardEvent)(this._inputHandler.onCursorMove, this._onCursorMove)), this.register((0, w3.forwardEvent)(this._inputHandler.onTitleChange, this._onTitleChange)), this.register((0, w3.forwardEvent)(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this.register((0, w3.forwardEvent)(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this.register(this._bufferService.onResize((e5) => this._afterResize(e5.cols, e5.rows))), this.register((0, E4.toDisposable)(() => {
              var e5, t7;
              this._customKeyEventHandler = void 0, null === (t7 = null === (e5 = this.element) || void 0 === e5 ? void 0 : e5.parentNode) || void 0 === t7 || t7.removeChild(this.element);
            }));
          }
          _handleColorEvent(e4) {
            if (this._themeService)
              for (const t7 of e4) {
                let e5, i9 = "";
                switch (t7.index) {
                  case 256:
                    e5 = "foreground", i9 = "10";
                    break;
                  case 257:
                    e5 = "background", i9 = "11";
                    break;
                  case 258:
                    e5 = "cursor", i9 = "12";
                    break;
                  default:
                    e5 = "ansi", i9 = "4;" + t7.index;
                }
                switch (t7.type) {
                  case 0:
                    const s12 = b4.color.toColorRGB("ansi" === e5 ? this._themeService.colors.ansi[t7.index] : this._themeService.colors[e5]);
                    this.coreService.triggerDataEvent(`${D4.C0.ESC}]${i9};${(0, x3.toRgbString)(s12)}${D4.C1_ESCAPED.ST}`);
                    break;
                  case 1:
                    if ("ansi" === e5)
                      this._themeService.modifyColors((e6) => e6.ansi[t7.index] = b4.rgba.toColor(...t7.color));
                    else {
                      const i10 = e5;
                      this._themeService.modifyColors((e6) => e6[i10] = b4.rgba.toColor(...t7.color));
                    }
                    break;
                  case 2:
                    this._themeService.restoreColor(t7.index);
                }
              }
          }
          _setup() {
            super._setup(), this._customKeyEventHandler = void 0;
          }
          get buffer() {
            return this.buffers.active;
          }
          focus() {
            this.textarea && this.textarea.focus({ preventScroll: true });
          }
          _handleScreenReaderModeOptionChange(e4) {
            e4 ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(M3.AccessibilityManager, this)) : this._accessibilityManager.clear();
          }
          _handleTextAreaFocus(e4) {
            this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D4.C0.ESC + "[I"), this.updateCursorStyle(e4), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
          }
          blur() {
            var e4;
            return null === (e4 = this.textarea) || void 0 === e4 ? void 0 : e4.blur();
          }
          _handleTextAreaBlur() {
            this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D4.C0.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
          }
          _syncTextArea() {
            if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService)
              return;
            const e4 = this.buffer.ybase + this.buffer.y, t7 = this.buffer.lines.get(e4);
            if (!t7)
              return;
            const i9 = Math.min(this.buffer.x, this.cols - 1), s12 = this._renderService.dimensions.css.cell.height, r5 = t7.getWidth(i9), n9 = this._renderService.dimensions.css.cell.width * r5, o6 = this.buffer.y * this._renderService.dimensions.css.cell.height, a9 = i9 * this._renderService.dimensions.css.cell.width;
            this.textarea.style.left = a9 + "px", this.textarea.style.top = o6 + "px", this.textarea.style.width = n9 + "px", this.textarea.style.height = s12 + "px", this.textarea.style.lineHeight = s12 + "px", this.textarea.style.zIndex = "-5";
          }
          _initGlobal() {
            this._bindKeys(), this.register((0, r4.addDisposableDomListener)(this.element, "copy", (e5) => {
              this.hasSelection() && (0, s11.copyHandler)(e5, this._selectionService);
            }));
            const e4 = (e5) => (0, s11.handlePasteEvent)(e5, this.textarea, this.coreService, this.optionsService);
            this.register((0, r4.addDisposableDomListener)(this.textarea, "paste", e4)), this.register((0, r4.addDisposableDomListener)(this.element, "paste", e4)), k2.isFirefox ? this.register((0, r4.addDisposableDomListener)(this.element, "mousedown", (e5) => {
              2 === e5.button && (0, s11.rightClickHandler)(e5, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            })) : this.register((0, r4.addDisposableDomListener)(this.element, "contextmenu", (e5) => {
              (0, s11.rightClickHandler)(e5, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            })), k2.isLinux && this.register((0, r4.addDisposableDomListener)(this.element, "auxclick", (e5) => {
              1 === e5.button && (0, s11.moveTextAreaUnderMouseCursor)(e5, this.textarea, this.screenElement);
            }));
          }
          _bindKeys() {
            this.register((0, r4.addDisposableDomListener)(this.textarea, "keyup", (e4) => this._keyUp(e4), true)), this.register((0, r4.addDisposableDomListener)(this.textarea, "keydown", (e4) => this._keyDown(e4), true)), this.register((0, r4.addDisposableDomListener)(this.textarea, "keypress", (e4) => this._keyPress(e4), true)), this.register((0, r4.addDisposableDomListener)(this.textarea, "compositionstart", () => this._compositionHelper.compositionstart())), this.register((0, r4.addDisposableDomListener)(this.textarea, "compositionupdate", (e4) => this._compositionHelper.compositionupdate(e4))), this.register((0, r4.addDisposableDomListener)(this.textarea, "compositionend", () => this._compositionHelper.compositionend())), this.register((0, r4.addDisposableDomListener)(this.textarea, "input", (e4) => this._inputEvent(e4), true)), this.register(this.onRender(() => this._compositionHelper.updateCompositionElements()));
          }
          open(e4) {
            var t7;
            if (!e4)
              throw new Error("Terminal requires a parent element.");
            e4.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this._document = e4.ownerDocument, this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e4.appendChild(this.element);
            const i9 = O2.createDocumentFragment();
            this._viewportElement = O2.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), i9.appendChild(this._viewportElement), this._viewportScrollArea = O2.createElement("div"), this._viewportScrollArea.classList.add("xterm-scroll-area"), this._viewportElement.appendChild(this._viewportScrollArea), this.screenElement = O2.createElement("div"), this.screenElement.classList.add("xterm-screen"), this._helperContainer = O2.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), i9.appendChild(this.screenElement), this.textarea = O2.createElement("textarea"), this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", o5.promptLabel), k2.isChromeOS || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._coreBrowserService = this._instantiationService.createInstance(v4.CoreBrowserService, this.textarea, null !== (t7 = this._document.defaultView) && void 0 !== t7 ? t7 : window), this._instantiationService.setService(S2.ICoreBrowserService, this._coreBrowserService), this.register((0, r4.addDisposableDomListener)(this.textarea, "focus", (e5) => this._handleTextAreaFocus(e5))), this.register((0, r4.addDisposableDomListener)(this.textarea, "blur", () => this._handleTextAreaBlur())), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(u9.CharSizeService, this._document, this._helperContainer), this._instantiationService.setService(S2.ICharSizeService, this._charSizeService), this._themeService = this._instantiationService.createInstance(C3.ThemeService), this._instantiationService.setService(S2.IThemeService, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(f5.CharacterJoinerService), this._instantiationService.setService(S2.ICharacterJoinerService, this._characterJoinerService), this._renderService = this.register(this._instantiationService.createInstance(g6.RenderService, this.rows, this.screenElement)), this._instantiationService.setService(S2.IRenderService, this._renderService), this.register(this._renderService.onRenderedViewportChange((e5) => this._onRender.fire(e5))), this.onResize((e5) => this._renderService.resize(e5.cols, e5.rows)), this._compositionView = O2.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance(d7.CompositionHelper, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this.element.appendChild(i9);
            try {
              this._onWillOpen.fire(this.element);
            } catch (e5) {
            }
            this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this._mouseService = this._instantiationService.createInstance(p5.MouseService), this._instantiationService.setService(S2.IMouseService, this._mouseService), this.viewport = this._instantiationService.createInstance(h3.Viewport, this._viewportElement, this._viewportScrollArea), this.viewport.onRequestScrollLines((e5) => this.scrollLines(e5.amount, e5.suppressScrollEvent, 1)), this.register(this._inputHandler.onRequestSyncScrollBar(() => this.viewport.syncScrollArea())), this.register(this.viewport), this.register(this.onCursorMove(() => {
              this._renderService.handleCursorMove(), this._syncTextArea();
            })), this.register(this.onResize(() => this._renderService.handleResize(this.cols, this.rows))), this.register(this.onBlur(() => this._renderService.handleBlur())), this.register(this.onFocus(() => this._renderService.handleFocus())), this.register(this._renderService.onDimensionsChange(() => this.viewport.syncScrollArea())), this._selectionService = this.register(this._instantiationService.createInstance(m8.SelectionService, this.element, this.screenElement, this.linkifier2)), this._instantiationService.setService(S2.ISelectionService, this._selectionService), this.register(this._selectionService.onRequestScrollLines((e5) => this.scrollLines(e5.amount, e5.suppressScrollEvent))), this.register(this._selectionService.onSelectionChange(() => this._onSelectionChange.fire())), this.register(this._selectionService.onRequestRedraw((e5) => this._renderService.handleSelectionChanged(e5.start, e5.end, e5.columnSelectMode))), this.register(this._selectionService.onLinuxMouseSelection((e5) => {
              this.textarea.value = e5, this.textarea.focus(), this.textarea.select();
            })), this.register(this._onScroll.event((e5) => {
              this.viewport.syncScrollArea(), this._selectionService.refresh();
            })), this.register((0, r4.addDisposableDomListener)(this._viewportElement, "scroll", () => this._selectionService.refresh())), this.linkifier2.attachToDom(this.screenElement, this._mouseService, this._renderService), this.register(this._instantiationService.createInstance(c12.BufferDecorationRenderer, this.screenElement)), this.register((0, r4.addDisposableDomListener)(this.element, "mousedown", (e5) => this._selectionService.handleMouseDown(e5))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(M3.AccessibilityManager, this)), this.register(this.optionsService.onSpecificOptionChange("screenReaderMode", (e5) => this._handleScreenReaderModeOptionChange(e5))), this.options.overviewRulerWidth && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l9.OverviewRulerRenderer, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRulerWidth", (e5) => {
              !this._overviewRulerRenderer && e5 && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l9.OverviewRulerRenderer, this._viewportElement, this.screenElement)));
            }), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
          }
          _createRenderer() {
            return this._instantiationService.createInstance(_4.DomRenderer, this.element, this.screenElement, this._viewportElement, this.linkifier2);
          }
          bindMouse() {
            const e4 = this, t7 = this.element;
            function i9(t8) {
              const i10 = e4._mouseService.getMouseReportCoords(t8, e4.screenElement);
              if (!i10)
                return false;
              let s13, r5;
              switch (t8.overrideType || t8.type) {
                case "mousemove":
                  r5 = 32, void 0 === t8.buttons ? (s13 = 3, void 0 !== t8.button && (s13 = t8.button < 3 ? t8.button : 3)) : s13 = 1 & t8.buttons ? 0 : 4 & t8.buttons ? 1 : 2 & t8.buttons ? 2 : 3;
                  break;
                case "mouseup":
                  r5 = 0, s13 = t8.button < 3 ? t8.button : 3;
                  break;
                case "mousedown":
                  r5 = 1, s13 = t8.button < 3 ? t8.button : 3;
                  break;
                case "wheel":
                  if (0 === e4.viewport.getLinesScrolled(t8))
                    return false;
                  r5 = t8.deltaY < 0 ? 0 : 1, s13 = 4;
                  break;
                default:
                  return false;
              }
              return !(void 0 === r5 || void 0 === s13 || s13 > 4) && e4.coreMouseService.triggerMouseEvent({ col: i10.col, row: i10.row, x: i10.x, y: i10.y, button: s13, action: r5, ctrl: t8.ctrlKey, alt: t8.altKey, shift: t8.shiftKey });
            }
            const s12 = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, n9 = { mouseup: (e5) => (i9(e5), e5.buttons || (this._document.removeEventListener("mouseup", s12.mouseup), s12.mousedrag && this._document.removeEventListener("mousemove", s12.mousedrag)), this.cancel(e5)), wheel: (e5) => (i9(e5), this.cancel(e5, true)), mousedrag: (e5) => {
              e5.buttons && i9(e5);
            }, mousemove: (e5) => {
              e5.buttons || i9(e5);
            } };
            this.register(this.coreMouseService.onProtocolChange((e5) => {
              e5 ? ("debug" === this.optionsService.rawOptions.logLevel && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(e5)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), 8 & e5 ? s12.mousemove || (t7.addEventListener("mousemove", n9.mousemove), s12.mousemove = n9.mousemove) : (t7.removeEventListener("mousemove", s12.mousemove), s12.mousemove = null), 16 & e5 ? s12.wheel || (t7.addEventListener("wheel", n9.wheel, { passive: false }), s12.wheel = n9.wheel) : (t7.removeEventListener("wheel", s12.wheel), s12.wheel = null), 2 & e5 ? s12.mouseup || (t7.addEventListener("mouseup", n9.mouseup), s12.mouseup = n9.mouseup) : (this._document.removeEventListener("mouseup", s12.mouseup), t7.removeEventListener("mouseup", s12.mouseup), s12.mouseup = null), 4 & e5 ? s12.mousedrag || (s12.mousedrag = n9.mousedrag) : (this._document.removeEventListener("mousemove", s12.mousedrag), s12.mousedrag = null);
            })), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this.register((0, r4.addDisposableDomListener)(t7, "mousedown", (e5) => {
              if (e5.preventDefault(), this.focus(), this.coreMouseService.areMouseEventsActive && !this._selectionService.shouldForceSelection(e5))
                return i9(e5), s12.mouseup && this._document.addEventListener("mouseup", s12.mouseup), s12.mousedrag && this._document.addEventListener("mousemove", s12.mousedrag), this.cancel(e5);
            })), this.register((0, r4.addDisposableDomListener)(t7, "wheel", (e5) => {
              if (!s12.wheel) {
                if (!this.buffer.hasScrollback) {
                  const t8 = this.viewport.getLinesScrolled(e5);
                  if (0 === t8)
                    return;
                  const i10 = D4.C0.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (e5.deltaY < 0 ? "A" : "B");
                  let s13 = "";
                  for (let e6 = 0; e6 < Math.abs(t8); e6++)
                    s13 += i10;
                  return this.coreService.triggerDataEvent(s13, true), this.cancel(e5, true);
                }
                return this.viewport.handleWheel(e5) ? this.cancel(e5) : void 0;
              }
            }, { passive: false })), this.register((0, r4.addDisposableDomListener)(t7, "touchstart", (e5) => {
              if (!this.coreMouseService.areMouseEventsActive)
                return this.viewport.handleTouchStart(e5), this.cancel(e5);
            }, { passive: true })), this.register((0, r4.addDisposableDomListener)(t7, "touchmove", (e5) => {
              if (!this.coreMouseService.areMouseEventsActive)
                return this.viewport.handleTouchMove(e5) ? void 0 : this.cancel(e5);
            }, { passive: false }));
          }
          refresh(e4, t7) {
            var i9;
            null === (i9 = this._renderService) || void 0 === i9 || i9.refreshRows(e4, t7);
          }
          updateCursorStyle(e4) {
            var t7;
            (null === (t7 = this._selectionService) || void 0 === t7 ? void 0 : t7.shouldColumnSelect(e4)) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
          }
          _showCursor() {
            this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
          }
          scrollLines(e4, t7, i9 = 0) {
            var s12;
            1 === i9 ? (super.scrollLines(e4, t7, i9), this.refresh(0, this.rows - 1)) : null === (s12 = this.viewport) || void 0 === s12 || s12.scrollLines(e4);
          }
          paste(e4) {
            (0, s11.paste)(e4, this.textarea, this.coreService, this.optionsService);
          }
          attachCustomKeyEventHandler(e4) {
            this._customKeyEventHandler = e4;
          }
          registerLinkProvider(e4) {
            return this.linkifier2.registerLinkProvider(e4);
          }
          registerCharacterJoiner(e4) {
            if (!this._characterJoinerService)
              throw new Error("Terminal must be opened first");
            const t7 = this._characterJoinerService.register(e4);
            return this.refresh(0, this.rows - 1), t7;
          }
          deregisterCharacterJoiner(e4) {
            if (!this._characterJoinerService)
              throw new Error("Terminal must be opened first");
            this._characterJoinerService.deregister(e4) && this.refresh(0, this.rows - 1);
          }
          get markers() {
            return this.buffer.markers;
          }
          registerMarker(e4) {
            return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e4);
          }
          registerDecoration(e4) {
            return this._decorationService.registerDecoration(e4);
          }
          hasSelection() {
            return !!this._selectionService && this._selectionService.hasSelection;
          }
          select(e4, t7, i9) {
            this._selectionService.setSelection(e4, t7, i9);
          }
          getSelection() {
            return this._selectionService ? this._selectionService.selectionText : "";
          }
          getSelectionPosition() {
            if (this._selectionService && this._selectionService.hasSelection)
              return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
          }
          clearSelection() {
            var e4;
            null === (e4 = this._selectionService) || void 0 === e4 || e4.clearSelection();
          }
          selectAll() {
            var e4;
            null === (e4 = this._selectionService) || void 0 === e4 || e4.selectAll();
          }
          selectLines(e4, t7) {
            var i9;
            null === (i9 = this._selectionService) || void 0 === i9 || i9.selectLines(e4, t7);
          }
          _keyDown(e4) {
            if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && false === this._customKeyEventHandler(e4))
              return false;
            const t7 = this.browser.isMac && this.options.macOptionIsMeta && e4.altKey;
            if (!t7 && !this._compositionHelper.keydown(e4))
              return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(), false;
            t7 || "Dead" !== e4.key && "AltGraph" !== e4.key || (this._unprocessedDeadKey = true);
            const i9 = (0, R2.evaluateKeyboardEvent)(e4, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
            if (this.updateCursorStyle(e4), 3 === i9.type || 2 === i9.type) {
              const t8 = this.rows - 1;
              return this.scrollLines(2 === i9.type ? -t8 : t8), this.cancel(e4, true);
            }
            return 1 === i9.type && this.selectAll(), !!this._isThirdLevelShift(this.browser, e4) || (i9.cancel && this.cancel(e4, true), !i9.key || !!(e4.key && !e4.ctrlKey && !e4.altKey && !e4.metaKey && 1 === e4.key.length && e4.key.charCodeAt(0) >= 65 && e4.key.charCodeAt(0) <= 90) || (this._unprocessedDeadKey ? (this._unprocessedDeadKey = false, true) : (i9.key !== D4.C0.ETX && i9.key !== D4.C0.CR || (this.textarea.value = ""), this._onKey.fire({ key: i9.key, domEvent: e4 }), this._showCursor(), this.coreService.triggerDataEvent(i9.key, true), !this.optionsService.rawOptions.screenReaderMode || e4.altKey || e4.ctrlKey ? this.cancel(e4, true) : void (this._keyDownHandled = true))));
          }
          _isThirdLevelShift(e4, t7) {
            const i9 = e4.isMac && !this.options.macOptionIsMeta && t7.altKey && !t7.ctrlKey && !t7.metaKey || e4.isWindows && t7.altKey && t7.ctrlKey && !t7.metaKey || e4.isWindows && t7.getModifierState("AltGraph");
            return "keypress" === t7.type ? i9 : i9 && (!t7.keyCode || t7.keyCode > 47);
          }
          _keyUp(e4) {
            this._keyDownSeen = false, this._customKeyEventHandler && false === this._customKeyEventHandler(e4) || (function(e5) {
              return 16 === e5.keyCode || 17 === e5.keyCode || 18 === e5.keyCode;
            }(e4) || this.focus(), this.updateCursorStyle(e4), this._keyPressHandled = false);
          }
          _keyPress(e4) {
            let t7;
            if (this._keyPressHandled = false, this._keyDownHandled)
              return false;
            if (this._customKeyEventHandler && false === this._customKeyEventHandler(e4))
              return false;
            if (this.cancel(e4), e4.charCode)
              t7 = e4.charCode;
            else if (null === e4.which || void 0 === e4.which)
              t7 = e4.keyCode;
            else {
              if (0 === e4.which || 0 === e4.charCode)
                return false;
              t7 = e4.which;
            }
            return !(!t7 || (e4.altKey || e4.ctrlKey || e4.metaKey) && !this._isThirdLevelShift(this.browser, e4) || (t7 = String.fromCharCode(t7), this._onKey.fire({ key: t7, domEvent: e4 }), this._showCursor(), this.coreService.triggerDataEvent(t7, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, 0));
          }
          _inputEvent(e4) {
            if (e4.data && "insertText" === e4.inputType && (!e4.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
              if (this._keyPressHandled)
                return false;
              this._unprocessedDeadKey = false;
              const t7 = e4.data;
              return this.coreService.triggerDataEvent(t7, true), this.cancel(e4), true;
            }
            return false;
          }
          resize(e4, t7) {
            e4 !== this.cols || t7 !== this.rows ? super.resize(e4, t7) : this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
          }
          _afterResize(e4, t7) {
            var i9, s12;
            null === (i9 = this._charSizeService) || void 0 === i9 || i9.measure(), null === (s12 = this.viewport) || void 0 === s12 || s12.syncScrollArea(true);
          }
          clear() {
            var e4;
            if (0 !== this.buffer.ybase || 0 !== this.buffer.y) {
              this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
              for (let e5 = 1; e5 < this.rows; e5++)
                this.buffer.lines.push(this.buffer.getBlankLine(L2.DEFAULT_ATTR_DATA));
              this._onScroll.fire({ position: this.buffer.ydisp, source: 0 }), null === (e4 = this.viewport) || void 0 === e4 || e4.reset(), this.refresh(0, this.rows - 1);
            }
          }
          reset() {
            var e4, t7;
            this.options.rows = this.rows, this.options.cols = this.cols;
            const i9 = this._customKeyEventHandler;
            this._setup(), super.reset(), null === (e4 = this._selectionService) || void 0 === e4 || e4.reset(), this._decorationService.reset(), null === (t7 = this.viewport) || void 0 === t7 || t7.reset(), this._customKeyEventHandler = i9, this.refresh(0, this.rows - 1);
          }
          clearTextureAtlas() {
            var e4;
            null === (e4 = this._renderService) || void 0 === e4 || e4.clearTextureAtlas();
          }
          _reportFocus() {
            var e4;
            (null === (e4 = this.element) || void 0 === e4 ? void 0 : e4.classList.contains("focus")) ? this.coreService.triggerDataEvent(D4.C0.ESC + "[I") : this.coreService.triggerDataEvent(D4.C0.ESC + "[O");
          }
          _reportWindowsOptions(e4) {
            if (this._renderService)
              switch (e4) {
                case T4.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:
                  const e5 = this._renderService.dimensions.css.canvas.width.toFixed(0), t7 = this._renderService.dimensions.css.canvas.height.toFixed(0);
                  this.coreService.triggerDataEvent(`${D4.C0.ESC}[4;${t7};${e5}t`);
                  break;
                case T4.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:
                  const i9 = this._renderService.dimensions.css.cell.width.toFixed(0), s12 = this._renderService.dimensions.css.cell.height.toFixed(0);
                  this.coreService.triggerDataEvent(`${D4.C0.ESC}[6;${s12};${i9}t`);
              }
          }
          cancel(e4, t7) {
            if (this.options.cancelEvents || t7)
              return e4.preventDefault(), e4.stopPropagation(), false;
          }
        }
        t6.Terminal = P2;
      }, 9924: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.TimeBasedDebouncer = void 0, t6.TimeBasedDebouncer = class {
          constructor(e4, t7 = 1e3) {
            this._renderCallback = e4, this._debounceThresholdMS = t7, this._lastRefreshMs = 0, this._additionalRefreshRequested = false;
          }
          dispose() {
            this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
          }
          refresh(e4, t7, i8) {
            this._rowCount = i8, e4 = void 0 !== e4 ? e4 : 0, t7 = void 0 !== t7 ? t7 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e4) : e4, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t7) : t7;
            const s11 = Date.now();
            if (s11 - this._lastRefreshMs >= this._debounceThresholdMS)
              this._lastRefreshMs = s11, this._innerRefresh();
            else if (!this._additionalRefreshRequested) {
              const e5 = s11 - this._lastRefreshMs, t8 = this._debounceThresholdMS - e5;
              this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout(() => {
                this._lastRefreshMs = Date.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
              }, t8);
            }
          }
          _innerRefresh() {
            if (void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount)
              return;
            const e4 = Math.max(this._rowStart, 0), t7 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e4, t7);
          }
        };
      }, 1680: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Viewport = void 0;
        const n8 = i8(3656), o5 = i8(4725), a8 = i8(8460), h3 = i8(844), c12 = i8(2585);
        let l9 = t6.Viewport = class extends h3.Disposable {
          constructor(e4, t7, i9, s12, r5, o6, h4, c13) {
            super(), this._viewportElement = e4, this._scrollArea = t7, this._bufferService = i9, this._optionsService = s12, this._charSizeService = r5, this._renderService = o6, this._coreBrowserService = h4, this.scrollBarWidth = 0, this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._wheelPartialScroll = 0, this._refreshAnimationFrame = null, this._ignoreNextScrollEvent = false, this._smoothScrollState = { startTime: 0, origin: -1, target: -1 }, this._onRequestScrollLines = this.register(new a8.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this.scrollBarWidth = this._viewportElement.offsetWidth - this._scrollArea.offsetWidth || 15, this.register((0, n8.addDisposableDomListener)(this._viewportElement, "scroll", this._handleScroll.bind(this))), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate((e5) => this._activeBuffer = e5.activeBuffer)), this._renderDimensions = this._renderService.dimensions, this.register(this._renderService.onDimensionsChange((e5) => this._renderDimensions = e5)), this._handleThemeChange(c13.colors), this.register(c13.onChangeColors((e5) => this._handleThemeChange(e5))), this.register(this._optionsService.onSpecificOptionChange("scrollback", () => this.syncScrollArea())), setTimeout(() => this.syncScrollArea());
          }
          _handleThemeChange(e4) {
            this._viewportElement.style.backgroundColor = e4.background.css;
          }
          reset() {
            this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._coreBrowserService.window.requestAnimationFrame(() => this.syncScrollArea());
          }
          _refresh(e4) {
            if (e4)
              return this._innerRefresh(), void (null !== this._refreshAnimationFrame && this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));
            null === this._refreshAnimationFrame && (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
          }
          _innerRefresh() {
            if (this._charSizeService.height > 0) {
              this._currentRowHeight = this._renderService.dimensions.device.cell.height / this._coreBrowserService.dpr, this._currentDeviceCellHeight = this._renderService.dimensions.device.cell.height, this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;
              const e5 = Math.round(this._currentRowHeight * this._lastRecordedBufferLength) + (this._lastRecordedViewportHeight - this._renderService.dimensions.css.canvas.height);
              this._lastRecordedBufferHeight !== e5 && (this._lastRecordedBufferHeight = e5, this._scrollArea.style.height = this._lastRecordedBufferHeight + "px");
            }
            const e4 = this._bufferService.buffer.ydisp * this._currentRowHeight;
            this._viewportElement.scrollTop !== e4 && (this._ignoreNextScrollEvent = true, this._viewportElement.scrollTop = e4), this._refreshAnimationFrame = null;
          }
          syncScrollArea(e4 = false) {
            if (this._lastRecordedBufferLength !== this._bufferService.buffer.lines.length)
              return this._lastRecordedBufferLength = this._bufferService.buffer.lines.length, void this._refresh(e4);
            this._lastRecordedViewportHeight === this._renderService.dimensions.css.canvas.height && this._lastScrollTop === this._activeBuffer.ydisp * this._currentRowHeight && this._renderDimensions.device.cell.height === this._currentDeviceCellHeight || this._refresh(e4);
          }
          _handleScroll(e4) {
            if (this._lastScrollTop = this._viewportElement.scrollTop, !this._viewportElement.offsetParent)
              return;
            if (this._ignoreNextScrollEvent)
              return this._ignoreNextScrollEvent = false, void this._onRequestScrollLines.fire({ amount: 0, suppressScrollEvent: true });
            const t7 = Math.round(this._lastScrollTop / this._currentRowHeight) - this._bufferService.buffer.ydisp;
            this._onRequestScrollLines.fire({ amount: t7, suppressScrollEvent: true });
          }
          _smoothScroll() {
            if (this._isDisposed || -1 === this._smoothScrollState.origin || -1 === this._smoothScrollState.target)
              return;
            const e4 = this._smoothScrollPercent();
            this._viewportElement.scrollTop = this._smoothScrollState.origin + Math.round(e4 * (this._smoothScrollState.target - this._smoothScrollState.origin)), e4 < 1 ? this._coreBrowserService.window.requestAnimationFrame(() => this._smoothScroll()) : this._clearSmoothScrollState();
          }
          _smoothScrollPercent() {
            return this._optionsService.rawOptions.smoothScrollDuration && this._smoothScrollState.startTime ? Math.max(Math.min((Date.now() - this._smoothScrollState.startTime) / this._optionsService.rawOptions.smoothScrollDuration, 1), 0) : 1;
          }
          _clearSmoothScrollState() {
            this._smoothScrollState.startTime = 0, this._smoothScrollState.origin = -1, this._smoothScrollState.target = -1;
          }
          _bubbleScroll(e4, t7) {
            const i9 = this._viewportElement.scrollTop + this._lastRecordedViewportHeight;
            return !(t7 < 0 && 0 !== this._viewportElement.scrollTop || t7 > 0 && i9 < this._lastRecordedBufferHeight) || (e4.cancelable && e4.preventDefault(), false);
          }
          handleWheel(e4) {
            const t7 = this._getPixelsScrolled(e4);
            return 0 !== t7 && (this._optionsService.rawOptions.smoothScrollDuration ? (this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, -1 === this._smoothScrollState.target ? this._smoothScrollState.target = this._viewportElement.scrollTop + t7 : this._smoothScrollState.target += t7, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState()) : this._viewportElement.scrollTop += t7, this._bubbleScroll(e4, t7));
          }
          scrollLines(e4) {
            if (0 !== e4)
              if (this._optionsService.rawOptions.smoothScrollDuration) {
                const t7 = e4 * this._currentRowHeight;
                this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, this._smoothScrollState.target = this._smoothScrollState.origin + t7, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState();
              } else
                this._onRequestScrollLines.fire({ amount: e4, suppressScrollEvent: false });
          }
          _getPixelsScrolled(e4) {
            if (0 === e4.deltaY || e4.shiftKey)
              return 0;
            let t7 = this._applyScrollModifier(e4.deltaY, e4);
            return e4.deltaMode === WheelEvent.DOM_DELTA_LINE ? t7 *= this._currentRowHeight : e4.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t7 *= this._currentRowHeight * this._bufferService.rows), t7;
          }
          getBufferElements(e4, t7) {
            var i9;
            let s12, r5 = "";
            const n9 = [], o6 = null != t7 ? t7 : this._bufferService.buffer.lines.length, a9 = this._bufferService.buffer.lines;
            for (let t8 = e4; t8 < o6; t8++) {
              const e5 = a9.get(t8);
              if (!e5)
                continue;
              const o7 = null === (i9 = a9.get(t8 + 1)) || void 0 === i9 ? void 0 : i9.isWrapped;
              if (r5 += e5.translateToString(!o7), !o7 || t8 === a9.length - 1) {
                const e6 = document.createElement("div");
                e6.textContent = r5, n9.push(e6), r5.length > 0 && (s12 = e6), r5 = "";
              }
            }
            return { bufferElements: n9, cursorElement: s12 };
          }
          getLinesScrolled(e4) {
            if (0 === e4.deltaY || e4.shiftKey)
              return 0;
            let t7 = this._applyScrollModifier(e4.deltaY, e4);
            return e4.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (t7 /= this._currentRowHeight + 0, this._wheelPartialScroll += t7, t7 = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e4.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t7 *= this._bufferService.rows), t7;
          }
          _applyScrollModifier(e4, t7) {
            const i9 = this._optionsService.rawOptions.fastScrollModifier;
            return "alt" === i9 && t7.altKey || "ctrl" === i9 && t7.ctrlKey || "shift" === i9 && t7.shiftKey ? e4 * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e4 * this._optionsService.rawOptions.scrollSensitivity;
          }
          handleTouchStart(e4) {
            this._lastTouchY = e4.touches[0].pageY;
          }
          handleTouchMove(e4) {
            const t7 = this._lastTouchY - e4.touches[0].pageY;
            return this._lastTouchY = e4.touches[0].pageY, 0 !== t7 && (this._viewportElement.scrollTop += t7, this._bubbleScroll(e4, t7));
          }
        };
        t6.Viewport = l9 = s11([r4(2, c12.IBufferService), r4(3, c12.IOptionsService), r4(4, o5.ICharSizeService), r4(5, o5.IRenderService), r4(6, o5.ICoreBrowserService), r4(7, o5.IThemeService)], l9);
      }, 3107: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferDecorationRenderer = void 0;
        const n8 = i8(3656), o5 = i8(4725), a8 = i8(844), h3 = i8(2585);
        let c12 = t6.BufferDecorationRenderer = class extends a8.Disposable {
          constructor(e4, t7, i9, s12) {
            super(), this._screenElement = e4, this._bufferService = t7, this._decorationService = i9, this._renderService = s12, this._decorationElements = /* @__PURE__ */ new Map(), this._altBufferIsActive = false, this._dimensionsChanged = false, this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this.register(this._renderService.onRenderedViewportChange(() => this._doRefreshDecorations())), this.register(this._renderService.onDimensionsChange(() => {
              this._dimensionsChanged = true, this._queueRefresh();
            })), this.register((0, n8.addDisposableDomListener)(window, "resize", () => this._queueRefresh())), this.register(this._bufferService.buffers.onBufferActivate(() => {
              this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
            })), this.register(this._decorationService.onDecorationRegistered(() => this._queueRefresh())), this.register(this._decorationService.onDecorationRemoved((e5) => this._removeDecoration(e5))), this.register((0, a8.toDisposable)(() => {
              this._container.remove(), this._decorationElements.clear();
            }));
          }
          _queueRefresh() {
            void 0 === this._animationFrame && (this._animationFrame = this._renderService.addRefreshCallback(() => {
              this._doRefreshDecorations(), this._animationFrame = void 0;
            }));
          }
          _doRefreshDecorations() {
            for (const e4 of this._decorationService.decorations)
              this._renderDecoration(e4);
            this._dimensionsChanged = false;
          }
          _renderDecoration(e4) {
            this._refreshStyle(e4), this._dimensionsChanged && this._refreshXPosition(e4);
          }
          _createElement(e4) {
            var t7, i9;
            const s12 = document.createElement("div");
            s12.classList.add("xterm-decoration"), s12.classList.toggle("xterm-decoration-top-layer", "top" === (null === (t7 = null == e4 ? void 0 : e4.options) || void 0 === t7 ? void 0 : t7.layer)), s12.style.width = `${Math.round((e4.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, s12.style.height = (e4.options.height || 1) * this._renderService.dimensions.css.cell.height + "px", s12.style.top = (e4.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height + "px", s12.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
            const r5 = null !== (i9 = e4.options.x) && void 0 !== i9 ? i9 : 0;
            return r5 && r5 > this._bufferService.cols && (s12.style.display = "none"), this._refreshXPosition(e4, s12), s12;
          }
          _refreshStyle(e4) {
            const t7 = e4.marker.line - this._bufferService.buffers.active.ydisp;
            if (t7 < 0 || t7 >= this._bufferService.rows)
              e4.element && (e4.element.style.display = "none", e4.onRenderEmitter.fire(e4.element));
            else {
              let i9 = this._decorationElements.get(e4);
              i9 || (i9 = this._createElement(e4), e4.element = i9, this._decorationElements.set(e4, i9), this._container.appendChild(i9), e4.onDispose(() => {
                this._decorationElements.delete(e4), i9.remove();
              })), i9.style.top = t7 * this._renderService.dimensions.css.cell.height + "px", i9.style.display = this._altBufferIsActive ? "none" : "block", e4.onRenderEmitter.fire(i9);
            }
          }
          _refreshXPosition(e4, t7 = e4.element) {
            var i9;
            if (!t7)
              return;
            const s12 = null !== (i9 = e4.options.x) && void 0 !== i9 ? i9 : 0;
            "right" === (e4.options.anchor || "left") ? t7.style.right = s12 ? s12 * this._renderService.dimensions.css.cell.width + "px" : "" : t7.style.left = s12 ? s12 * this._renderService.dimensions.css.cell.width + "px" : "";
          }
          _removeDecoration(e4) {
            var t7;
            null === (t7 = this._decorationElements.get(e4)) || void 0 === t7 || t7.remove(), this._decorationElements.delete(e4), e4.dispose();
          }
        };
        t6.BufferDecorationRenderer = c12 = s11([r4(1, h3.IBufferService), r4(2, h3.IDecorationService), r4(3, o5.IRenderService)], c12);
      }, 5871: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ColorZoneStore = void 0, t6.ColorZoneStore = class {
          constructor() {
            this._zones = [], this._zonePool = [], this._zonePoolIndex = 0, this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
          }
          get zones() {
            return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
          }
          clear() {
            this._zones.length = 0, this._zonePoolIndex = 0;
          }
          addDecoration(e4) {
            if (e4.options.overviewRulerOptions) {
              for (const t7 of this._zones)
                if (t7.color === e4.options.overviewRulerOptions.color && t7.position === e4.options.overviewRulerOptions.position) {
                  if (this._lineIntersectsZone(t7, e4.marker.line))
                    return;
                  if (this._lineAdjacentToZone(t7, e4.marker.line, e4.options.overviewRulerOptions.position))
                    return void this._addLineToZone(t7, e4.marker.line);
                }
              if (this._zonePoolIndex < this._zonePool.length)
                return this._zonePool[this._zonePoolIndex].color = e4.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = e4.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = e4.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = e4.marker.line, void this._zones.push(this._zonePool[this._zonePoolIndex++]);
              this._zones.push({ color: e4.options.overviewRulerOptions.color, position: e4.options.overviewRulerOptions.position, startBufferLine: e4.marker.line, endBufferLine: e4.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
            }
          }
          setPadding(e4) {
            this._linePadding = e4;
          }
          _lineIntersectsZone(e4, t7) {
            return t7 >= e4.startBufferLine && t7 <= e4.endBufferLine;
          }
          _lineAdjacentToZone(e4, t7, i8) {
            return t7 >= e4.startBufferLine - this._linePadding[i8 || "full"] && t7 <= e4.endBufferLine + this._linePadding[i8 || "full"];
          }
          _addLineToZone(e4, t7) {
            e4.startBufferLine = Math.min(e4.startBufferLine, t7), e4.endBufferLine = Math.max(e4.endBufferLine, t7);
          }
        };
      }, 5744: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.OverviewRulerRenderer = void 0;
        const n8 = i8(5871), o5 = i8(3656), a8 = i8(4725), h3 = i8(844), c12 = i8(2585), l9 = { full: 0, left: 0, center: 0, right: 0 }, d7 = { full: 0, left: 0, center: 0, right: 0 }, _4 = { full: 0, left: 0, center: 0, right: 0 };
        let u9 = t6.OverviewRulerRenderer = class extends h3.Disposable {
          get _width() {
            return this._optionsService.options.overviewRulerWidth || 0;
          }
          constructor(e4, t7, i9, s12, r5, o6, a9) {
            var c13;
            super(), this._viewportElement = e4, this._screenElement = t7, this._bufferService = i9, this._decorationService = s12, this._renderService = r5, this._optionsService = o6, this._coreBrowseService = a9, this._colorZoneStore = new n8.ColorZoneStore(), this._shouldUpdateDimensions = true, this._shouldUpdateAnchor = true, this._lastKnownBufferLength = 0, this._canvas = document.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), null === (c13 = this._viewportElement.parentElement) || void 0 === c13 || c13.insertBefore(this._canvas, this._viewportElement);
            const l10 = this._canvas.getContext("2d");
            if (!l10)
              throw new Error("Ctx cannot be null");
            this._ctx = l10, this._registerDecorationListeners(), this._registerBufferChangeListeners(), this._registerDimensionChangeListeners(), this.register((0, h3.toDisposable)(() => {
              var e5;
              null === (e5 = this._canvas) || void 0 === e5 || e5.remove();
            }));
          }
          _registerDecorationListeners() {
            this.register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(void 0, true))), this.register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(void 0, true)));
          }
          _registerBufferChangeListeners() {
            this.register(this._renderService.onRenderedViewportChange(() => this._queueRefresh())), this.register(this._bufferService.buffers.onBufferActivate(() => {
              this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
            })), this.register(this._bufferService.onScroll(() => {
              this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
            }));
          }
          _registerDimensionChangeListeners() {
            this.register(this._renderService.onRender(() => {
              this._containerHeight && this._containerHeight === this._screenElement.clientHeight || (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
            })), this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth", () => this._queueRefresh(true))), this.register((0, o5.addDisposableDomListener)(this._coreBrowseService.window, "resize", () => this._queueRefresh(true))), this._queueRefresh(true);
          }
          _refreshDrawConstants() {
            const e4 = Math.floor(this._canvas.width / 3), t7 = Math.ceil(this._canvas.width / 3);
            d7.full = this._canvas.width, d7.left = e4, d7.center = t7, d7.right = e4, this._refreshDrawHeightConstants(), _4.full = 0, _4.left = 0, _4.center = d7.left, _4.right = d7.left + d7.center;
          }
          _refreshDrawHeightConstants() {
            l9.full = Math.round(2 * this._coreBrowseService.dpr);
            const e4 = this._canvas.height / this._bufferService.buffer.lines.length, t7 = Math.round(Math.max(Math.min(e4, 12), 6) * this._coreBrowseService.dpr);
            l9.left = t7, l9.center = t7, l9.right = t7;
          }
          _refreshColorZonePadding() {
            this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l9.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l9.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l9.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l9.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
          }
          _refreshCanvasDimensions() {
            this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowseService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowseService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
          }
          _refreshDecorations() {
            this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
            for (const e5 of this._decorationService.decorations)
              this._colorZoneStore.addDecoration(e5);
            this._ctx.lineWidth = 1;
            const e4 = this._colorZoneStore.zones;
            for (const t7 of e4)
              "full" !== t7.position && this._renderColorZone(t7);
            for (const t7 of e4)
              "full" === t7.position && this._renderColorZone(t7);
            this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
          }
          _renderColorZone(e4) {
            this._ctx.fillStyle = e4.color, this._ctx.fillRect(_4[e4.position || "full"], Math.round((this._canvas.height - 1) * (e4.startBufferLine / this._bufferService.buffers.active.lines.length) - l9[e4.position || "full"] / 2), d7[e4.position || "full"], Math.round((this._canvas.height - 1) * ((e4.endBufferLine - e4.startBufferLine) / this._bufferService.buffers.active.lines.length) + l9[e4.position || "full"]));
          }
          _queueRefresh(e4, t7) {
            this._shouldUpdateDimensions = e4 || this._shouldUpdateDimensions, this._shouldUpdateAnchor = t7 || this._shouldUpdateAnchor, void 0 === this._animationFrame && (this._animationFrame = this._coreBrowseService.window.requestAnimationFrame(() => {
              this._refreshDecorations(), this._animationFrame = void 0;
            }));
          }
        };
        t6.OverviewRulerRenderer = u9 = s11([r4(2, c12.IBufferService), r4(3, c12.IDecorationService), r4(4, a8.IRenderService), r4(5, c12.IOptionsService), r4(6, a8.ICoreBrowserService)], u9);
      }, 2950: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CompositionHelper = void 0;
        const n8 = i8(4725), o5 = i8(2585), a8 = i8(2584);
        let h3 = t6.CompositionHelper = class {
          get isComposing() {
            return this._isComposing;
          }
          constructor(e4, t7, i9, s12, r5, n9) {
            this._textarea = e4, this._compositionView = t7, this._bufferService = i9, this._optionsService = s12, this._coreService = r5, this._renderService = n9, this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
          }
          compositionstart() {
            this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
          }
          compositionupdate(e4) {
            this._compositionView.textContent = e4.data, this.updateCompositionElements(), setTimeout(() => {
              this._compositionPosition.end = this._textarea.value.length;
            }, 0);
          }
          compositionend() {
            this._finalizeComposition(true);
          }
          keydown(e4) {
            if (this._isComposing || this._isSendingComposition) {
              if (229 === e4.keyCode)
                return false;
              if (16 === e4.keyCode || 17 === e4.keyCode || 18 === e4.keyCode)
                return false;
              this._finalizeComposition(false);
            }
            return 229 !== e4.keyCode || (this._handleAnyTextareaChanges(), false);
          }
          _finalizeComposition(e4) {
            if (this._compositionView.classList.remove("active"), this._isComposing = false, e4) {
              const e5 = { start: this._compositionPosition.start, end: this._compositionPosition.end };
              this._isSendingComposition = true, setTimeout(() => {
                if (this._isSendingComposition) {
                  let t7;
                  this._isSendingComposition = false, e5.start += this._dataAlreadySent.length, t7 = this._isComposing ? this._textarea.value.substring(e5.start, e5.end) : this._textarea.value.substring(e5.start), t7.length > 0 && this._coreService.triggerDataEvent(t7, true);
                }
              }, 0);
            } else {
              this._isSendingComposition = false;
              const e5 = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
              this._coreService.triggerDataEvent(e5, true);
            }
          }
          _handleAnyTextareaChanges() {
            const e4 = this._textarea.value;
            setTimeout(() => {
              if (!this._isComposing) {
                const t7 = this._textarea.value, i9 = t7.replace(e4, "");
                this._dataAlreadySent = i9, t7.length > e4.length ? this._coreService.triggerDataEvent(i9, true) : t7.length < e4.length ? this._coreService.triggerDataEvent(`${a8.C0.DEL}`, true) : t7.length === e4.length && t7 !== e4 && this._coreService.triggerDataEvent(t7, true);
              }
            }, 0);
          }
          updateCompositionElements(e4) {
            if (this._isComposing) {
              if (this._bufferService.buffer.isCursorInViewport) {
                const e5 = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), t7 = this._renderService.dimensions.css.cell.height, i9 = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, s12 = e5 * this._renderService.dimensions.css.cell.width;
                this._compositionView.style.left = s12 + "px", this._compositionView.style.top = i9 + "px", this._compositionView.style.height = t7 + "px", this._compositionView.style.lineHeight = t7 + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
                const r5 = this._compositionView.getBoundingClientRect();
                this._textarea.style.left = s12 + "px", this._textarea.style.top = i9 + "px", this._textarea.style.width = Math.max(r5.width, 1) + "px", this._textarea.style.height = Math.max(r5.height, 1) + "px", this._textarea.style.lineHeight = r5.height + "px";
              }
              e4 || setTimeout(() => this.updateCompositionElements(true), 0);
            }
          }
        };
        t6.CompositionHelper = h3 = s11([r4(2, o5.IBufferService), r4(3, o5.IOptionsService), r4(4, o5.ICoreService), r4(5, n8.IRenderService)], h3);
      }, 9806: (e3, t6) => {
        function i8(e4, t7, i9) {
          const s11 = i9.getBoundingClientRect(), r4 = e4.getComputedStyle(i9), n8 = parseInt(r4.getPropertyValue("padding-left")), o5 = parseInt(r4.getPropertyValue("padding-top"));
          return [t7.clientX - s11.left - n8, t7.clientY - s11.top - o5];
        }
        Object.defineProperty(t6, "__esModule", { value: true }), t6.getCoords = t6.getCoordsRelativeToElement = void 0, t6.getCoordsRelativeToElement = i8, t6.getCoords = function(e4, t7, s11, r4, n8, o5, a8, h3, c12) {
          if (!o5)
            return;
          const l9 = i8(e4, t7, s11);
          return l9 ? (l9[0] = Math.ceil((l9[0] + (c12 ? a8 / 2 : 0)) / a8), l9[1] = Math.ceil(l9[1] / h3), l9[0] = Math.min(Math.max(l9[0], 1), r4 + (c12 ? 1 : 0)), l9[1] = Math.min(Math.max(l9[1], 1), n8), l9) : void 0;
        };
      }, 9504: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.moveToCellSequence = void 0;
        const s11 = i8(2584);
        function r4(e4, t7, i9, s12) {
          const r5 = e4 - n8(e4, i9), a9 = t7 - n8(t7, i9), l9 = Math.abs(r5 - a9) - function(e5, t8, i10) {
            let s13 = 0;
            const r6 = e5 - n8(e5, i10), a10 = t8 - n8(t8, i10);
            for (let n9 = 0; n9 < Math.abs(r6 - a10); n9++) {
              const a11 = "A" === o5(e5, t8) ? -1 : 1, h4 = i10.buffer.lines.get(r6 + a11 * n9);
              (null == h4 ? void 0 : h4.isWrapped) && s13++;
            }
            return s13;
          }(e4, t7, i9);
          return c12(l9, h3(o5(e4, t7), s12));
        }
        function n8(e4, t7) {
          let i9 = 0, s12 = t7.buffer.lines.get(e4), r5 = null == s12 ? void 0 : s12.isWrapped;
          for (; r5 && e4 >= 0 && e4 < t7.rows; )
            i9++, s12 = t7.buffer.lines.get(--e4), r5 = null == s12 ? void 0 : s12.isWrapped;
          return i9;
        }
        function o5(e4, t7) {
          return e4 > t7 ? "A" : "B";
        }
        function a8(e4, t7, i9, s12, r5, n9) {
          let o6 = e4, a9 = t7, h4 = "";
          for (; o6 !== i9 || a9 !== s12; )
            o6 += r5 ? 1 : -1, r5 && o6 > n9.cols - 1 ? (h4 += n9.buffer.translateBufferLineToString(a9, false, e4, o6), o6 = 0, e4 = 0, a9++) : !r5 && o6 < 0 && (h4 += n9.buffer.translateBufferLineToString(a9, false, 0, e4 + 1), o6 = n9.cols - 1, e4 = o6, a9--);
          return h4 + n9.buffer.translateBufferLineToString(a9, false, e4, o6);
        }
        function h3(e4, t7) {
          const i9 = t7 ? "O" : "[";
          return s11.C0.ESC + i9 + e4;
        }
        function c12(e4, t7) {
          e4 = Math.floor(e4);
          let i9 = "";
          for (let s12 = 0; s12 < e4; s12++)
            i9 += t7;
          return i9;
        }
        t6.moveToCellSequence = function(e4, t7, i9, s12) {
          const o6 = i9.buffer.x, l9 = i9.buffer.y;
          if (!i9.buffer.hasScrollback)
            return function(e5, t8, i10, s13, o7, l10) {
              return 0 === r4(t8, s13, o7, l10).length ? "" : c12(a8(e5, t8, e5, t8 - n8(t8, o7), false, o7).length, h3("D", l10));
            }(o6, l9, 0, t7, i9, s12) + r4(l9, t7, i9, s12) + function(e5, t8, i10, s13, o7, l10) {
              let d8;
              d8 = r4(t8, s13, o7, l10).length > 0 ? s13 - n8(s13, o7) : t8;
              const _5 = s13, u9 = function(e6, t9, i11, s14, o8, a9) {
                let h4;
                return h4 = r4(i11, s14, o8, a9).length > 0 ? s14 - n8(s14, o8) : t9, e6 < i11 && h4 <= s14 || e6 >= i11 && h4 < s14 ? "C" : "D";
              }(e5, t8, i10, s13, o7, l10);
              return c12(a8(e5, d8, i10, _5, "C" === u9, o7).length, h3(u9, l10));
            }(o6, l9, e4, t7, i9, s12);
          let d7;
          if (l9 === t7)
            return d7 = o6 > e4 ? "D" : "C", c12(Math.abs(o6 - e4), h3(d7, s12));
          d7 = l9 > t7 ? "D" : "C";
          const _4 = Math.abs(l9 - t7);
          return c12(function(e5, t8) {
            return t8.cols - e5;
          }(l9 > t7 ? e4 : o6, i9) + (_4 - 1) * i9.cols + 1 + ((l9 > t7 ? o6 : e4) - 1), h3(d7, s12));
        };
      }, 1296: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DomRenderer = void 0;
        const n8 = i8(3787), o5 = i8(2550), a8 = i8(2223), h3 = i8(6171), c12 = i8(4725), l9 = i8(8055), d7 = i8(8460), _4 = i8(844), u9 = i8(2585), f5 = "xterm-dom-renderer-owner-", v4 = "xterm-rows", p5 = "xterm-fg-", g6 = "xterm-bg-", m8 = "xterm-focus", S2 = "xterm-selection";
        let C3 = 1, b4 = t6.DomRenderer = class extends _4.Disposable {
          constructor(e4, t7, i9, s12, r5, a9, c13, l10, u10, p6) {
            super(), this._element = e4, this._screenElement = t7, this._viewportElement = i9, this._linkifier2 = s12, this._charSizeService = a9, this._optionsService = c13, this._bufferService = l10, this._coreBrowserService = u10, this._themeService = p6, this._terminalClass = C3++, this._rowElements = [], this.onRequestRedraw = this.register(new d7.EventEmitter()).event, this._rowContainer = document.createElement("div"), this._rowContainer.classList.add(v4), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = document.createElement("div"), this._selectionContainer.classList.add(S2), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = (0, h3.createRenderDimensions)(), this._updateDimensions(), this.register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this.register(this._themeService.onChangeColors((e5) => this._injectCss(e5))), this._injectCss(this._themeService.colors), this._rowFactory = r5.createInstance(n8.DomRendererRowFactory, document), this._element.classList.add(f5 + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this.register(this._linkifier2.onShowLinkUnderline((e5) => this._handleLinkHover(e5))), this.register(this._linkifier2.onHideLinkUnderline((e5) => this._handleLinkLeave(e5))), this.register((0, _4.toDisposable)(() => {
              this._element.classList.remove(f5 + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
            })), this._widthCache = new o5.WidthCache(document), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          _updateDimensions() {
            const e4 = this._coreBrowserService.dpr;
            this.dimensions.device.char.width = this._charSizeService.width * e4, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e4), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e4), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e4), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
            for (const e5 of this._rowElements)
              e5.style.width = `${this.dimensions.css.canvas.width}px`, e5.style.height = `${this.dimensions.css.cell.height}px`, e5.style.lineHeight = `${this.dimensions.css.cell.height}px`, e5.style.overflow = "hidden";
            this._dimensionsStyleElement || (this._dimensionsStyleElement = document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
            const t7 = `${this._terminalSelector} .${v4} span { display: inline-block; height: 100%; vertical-align: top;}`;
            this._dimensionsStyleElement.textContent = t7, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
          }
          _injectCss(e4) {
            this._themeStyleElement || (this._themeStyleElement = document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
            let t7 = `${this._terminalSelector} .${v4} { color: ${e4.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
            t7 += `${this._terminalSelector} .${v4} .xterm-dim { color: ${l9.color.multiplyOpacity(e4.foreground, 0.5).css};}`, t7 += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`, t7 += "@keyframes blink_box_shadow_" + this._terminalClass + " { 50% {  border-bottom-style: hidden; }}", t7 += "@keyframes blink_block_" + this._terminalClass + ` { 0% {  background-color: ${e4.cursor.css};  color: ${e4.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e4.cursor.css}; }}`, t7 += `${this._terminalSelector} .${v4}.${m8} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_` + this._terminalClass + ` 1s step-end infinite;}${this._terminalSelector} .${v4}.${m8} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_` + this._terminalClass + ` 1s step-end infinite;}${this._terminalSelector} .${v4} .xterm-cursor.xterm-cursor-block { background-color: ${e4.cursor.css}; color: ${e4.cursorAccent.css};}${this._terminalSelector} .${v4} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e4.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${v4} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e4.cursor.css} inset;}${this._terminalSelector} .${v4} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e4.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, t7 += `${this._terminalSelector} .${S2} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S2} div { position: absolute; background-color: ${e4.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S2} div { position: absolute; background-color: ${e4.selectionInactiveBackgroundOpaque.css};}`;
            for (const [i9, s12] of e4.ansi.entries())
              t7 += `${this._terminalSelector} .${p5}${i9} { color: ${s12.css}; }${this._terminalSelector} .${p5}${i9}.xterm-dim { color: ${l9.color.multiplyOpacity(s12, 0.5).css}; }${this._terminalSelector} .${g6}${i9} { background-color: ${s12.css}; }`;
            t7 += `${this._terminalSelector} .${p5}${a8.INVERTED_DEFAULT_COLOR} { color: ${l9.color.opaque(e4.background).css}; }${this._terminalSelector} .${p5}${a8.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${l9.color.multiplyOpacity(l9.color.opaque(e4.background), 0.5).css}; }${this._terminalSelector} .${g6}${a8.INVERTED_DEFAULT_COLOR} { background-color: ${e4.foreground.css}; }`, this._themeStyleElement.textContent = t7;
          }
          _setDefaultSpacing() {
            const e4 = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
            this._rowContainer.style.letterSpacing = `${e4}px`, this._rowFactory.defaultSpacing = e4;
          }
          handleDevicePixelRatioChange() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          _refreshRowElements(e4, t7) {
            for (let e5 = this._rowElements.length; e5 <= t7; e5++) {
              const e6 = document.createElement("div");
              this._rowContainer.appendChild(e6), this._rowElements.push(e6);
            }
            for (; this._rowElements.length > t7; )
              this._rowContainer.removeChild(this._rowElements.pop());
          }
          handleResize(e4, t7) {
            this._refreshRowElements(e4, t7), this._updateDimensions();
          }
          handleCharSizeChanged() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          handleBlur() {
            this._rowContainer.classList.remove(m8);
          }
          handleFocus() {
            this._rowContainer.classList.add(m8), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
          }
          handleSelectionChanged(e4, t7, i9) {
            if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e4, t7, i9), this.renderRows(0, this._bufferService.rows - 1), !e4 || !t7)
              return;
            const s12 = e4[1] - this._bufferService.buffer.ydisp, r5 = t7[1] - this._bufferService.buffer.ydisp, n9 = Math.max(s12, 0), o6 = Math.min(r5, this._bufferService.rows - 1);
            if (n9 >= this._bufferService.rows || o6 < 0)
              return;
            const a9 = document.createDocumentFragment();
            if (i9) {
              const i10 = e4[0] > t7[0];
              a9.appendChild(this._createSelectionElement(n9, i10 ? t7[0] : e4[0], i10 ? e4[0] : t7[0], o6 - n9 + 1));
            } else {
              const i10 = s12 === n9 ? e4[0] : 0, h4 = n9 === r5 ? t7[0] : this._bufferService.cols;
              a9.appendChild(this._createSelectionElement(n9, i10, h4));
              const c13 = o6 - n9 - 1;
              if (a9.appendChild(this._createSelectionElement(n9 + 1, 0, this._bufferService.cols, c13)), n9 !== o6) {
                const e5 = r5 === o6 ? t7[0] : this._bufferService.cols;
                a9.appendChild(this._createSelectionElement(o6, 0, e5));
              }
            }
            this._selectionContainer.appendChild(a9);
          }
          _createSelectionElement(e4, t7, i9, s12 = 1) {
            const r5 = document.createElement("div");
            return r5.style.height = s12 * this.dimensions.css.cell.height + "px", r5.style.top = e4 * this.dimensions.css.cell.height + "px", r5.style.left = t7 * this.dimensions.css.cell.width + "px", r5.style.width = this.dimensions.css.cell.width * (i9 - t7) + "px", r5;
          }
          handleCursorMove() {
          }
          _handleOptionsChanged() {
            this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          clear() {
            for (const e4 of this._rowElements)
              e4.replaceChildren();
          }
          renderRows(e4, t7) {
            const i9 = this._bufferService.buffer, s12 = i9.ybase + i9.y, r5 = Math.min(i9.x, this._bufferService.cols - 1), n9 = this._optionsService.rawOptions.cursorBlink, o6 = this._optionsService.rawOptions.cursorStyle, a9 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let h4 = e4; h4 <= t7; h4++) {
              const e5 = h4 + i9.ydisp, t8 = this._rowElements[h4], c13 = i9.lines.get(e5);
              if (!t8 || !c13)
                break;
              t8.replaceChildren(...this._rowFactory.createRow(c13, e5, e5 === s12, o6, a9, r5, n9, this.dimensions.css.cell.width, this._widthCache, -1, -1));
            }
          }
          get _terminalSelector() {
            return `.${f5}${this._terminalClass}`;
          }
          _handleLinkHover(e4) {
            this._setCellUnderline(e4.x1, e4.x2, e4.y1, e4.y2, e4.cols, true);
          }
          _handleLinkLeave(e4) {
            this._setCellUnderline(e4.x1, e4.x2, e4.y1, e4.y2, e4.cols, false);
          }
          _setCellUnderline(e4, t7, i9, s12, r5, n9) {
            i9 < 0 && (e4 = 0), s12 < 0 && (t7 = 0);
            const o6 = this._bufferService.rows - 1;
            i9 = Math.max(Math.min(i9, o6), 0), s12 = Math.max(Math.min(s12, o6), 0), r5 = Math.min(r5, this._bufferService.cols);
            const a9 = this._bufferService.buffer, h4 = a9.ybase + a9.y, c13 = Math.min(a9.x, r5 - 1), l10 = this._optionsService.rawOptions.cursorBlink, d8 = this._optionsService.rawOptions.cursorStyle, _5 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let o7 = i9; o7 <= s12; ++o7) {
              const u10 = o7 + a9.ydisp, f6 = this._rowElements[o7], v5 = a9.lines.get(u10);
              if (!f6 || !v5)
                break;
              f6.replaceChildren(...this._rowFactory.createRow(v5, u10, u10 === h4, d8, _5, c13, l10, this.dimensions.css.cell.width, this._widthCache, n9 ? o7 === i9 ? e4 : 0 : -1, n9 ? (o7 === s12 ? t7 : r5) - 1 : -1));
            }
          }
        };
        t6.DomRenderer = b4 = s11([r4(4, u9.IInstantiationService), r4(5, c12.ICharSizeService), r4(6, u9.IOptionsService), r4(7, u9.IBufferService), r4(8, c12.ICoreBrowserService), r4(9, c12.IThemeService)], b4);
      }, 3787: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DomRendererRowFactory = void 0;
        const n8 = i8(2223), o5 = i8(643), a8 = i8(511), h3 = i8(2585), c12 = i8(8055), l9 = i8(4725), d7 = i8(4269), _4 = i8(6171), u9 = i8(3734);
        let f5 = t6.DomRendererRowFactory = class {
          constructor(e4, t7, i9, s12, r5, n9, o6) {
            this._document = e4, this._characterJoinerService = t7, this._optionsService = i9, this._coreBrowserService = s12, this._coreService = r5, this._decorationService = n9, this._themeService = o6, this._workCell = new a8.CellData(), this._columnSelectMode = false, this.defaultSpacing = 0;
          }
          handleSelectionChanged(e4, t7, i9) {
            this._selectionStart = e4, this._selectionEnd = t7, this._columnSelectMode = i9;
          }
          createRow(e4, t7, i9, s12, r5, a9, h4, l10, _5, f6, p5) {
            const g6 = [], m8 = this._characterJoinerService.getJoinedCharacters(t7), S2 = this._themeService.colors;
            let C3, b4 = e4.getNoBgTrimmedLength();
            i9 && b4 < a9 + 1 && (b4 = a9 + 1);
            let y4 = 0, w3 = "", E4 = 0, k2 = 0, L2 = 0, D4 = false, R2 = 0, x3 = false, A2 = 0;
            const B2 = [], T4 = -1 !== f6 && -1 !== p5;
            for (let M3 = 0; M3 < b4; M3++) {
              e4.loadCell(M3, this._workCell);
              let b5 = this._workCell.getWidth();
              if (0 === b5)
                continue;
              let O2 = false, P2 = M3, I = this._workCell;
              if (m8.length > 0 && M3 === m8[0][0]) {
                O2 = true;
                const t8 = m8.shift();
                I = new d7.JoinedCellData(this._workCell, e4.translateToString(true, t8[0], t8[1]), t8[1] - t8[0]), P2 = t8[1] - 1, b5 = I.getWidth();
              }
              const H2 = this._isCellInSelection(M3, t7), F3 = i9 && M3 === a9, W4 = T4 && M3 >= f6 && M3 <= p5;
              let U = false;
              this._decorationService.forEachDecorationAtCell(M3, t7, void 0, (e5) => {
                U = true;
              });
              let N = I.getChars() || o5.WHITESPACE_CELL_CHAR;
              if (" " === N && (I.isUnderline() || I.isOverline()) && (N = "\xA0"), A2 = b5 * l10 - _5.get(N, I.isBold(), I.isItalic()), C3) {
                if (y4 && (H2 && x3 || !H2 && !x3 && I.bg === E4) && (H2 && x3 && S2.selectionForeground || I.fg === k2) && I.extended.ext === L2 && W4 === D4 && A2 === R2 && !F3 && !O2 && !U) {
                  w3 += N, y4++;
                  continue;
                }
                y4 && (C3.textContent = w3), C3 = this._document.createElement("span"), y4 = 0, w3 = "";
              } else
                C3 = this._document.createElement("span");
              if (E4 = I.bg, k2 = I.fg, L2 = I.extended.ext, D4 = W4, R2 = A2, x3 = H2, O2 && a9 >= M3 && a9 <= P2 && (a9 = M3), !this._coreService.isCursorHidden && F3) {
                if (B2.push("xterm-cursor"), this._coreBrowserService.isFocused)
                  h4 && B2.push("xterm-cursor-blink"), B2.push("bar" === s12 ? "xterm-cursor-bar" : "underline" === s12 ? "xterm-cursor-underline" : "xterm-cursor-block");
                else if (r5)
                  switch (r5) {
                    case "outline":
                      B2.push("xterm-cursor-outline");
                      break;
                    case "block":
                      B2.push("xterm-cursor-block");
                      break;
                    case "bar":
                      B2.push("xterm-cursor-bar");
                      break;
                    case "underline":
                      B2.push("xterm-cursor-underline");
                  }
              }
              if (I.isBold() && B2.push("xterm-bold"), I.isItalic() && B2.push("xterm-italic"), I.isDim() && B2.push("xterm-dim"), w3 = I.isInvisible() ? o5.WHITESPACE_CELL_CHAR : I.getChars() || o5.WHITESPACE_CELL_CHAR, I.isUnderline() && (B2.push(`xterm-underline-${I.extended.underlineStyle}`), " " === w3 && (w3 = "\xA0"), !I.isUnderlineColorDefault()))
                if (I.isUnderlineColorRGB())
                  C3.style.textDecorationColor = `rgb(${u9.AttributeData.toColorRGB(I.getUnderlineColor()).join(",")})`;
                else {
                  let e5 = I.getUnderlineColor();
                  this._optionsService.rawOptions.drawBoldTextInBrightColors && I.isBold() && e5 < 8 && (e5 += 8), C3.style.textDecorationColor = S2.ansi[e5].css;
                }
              I.isOverline() && (B2.push("xterm-overline"), " " === w3 && (w3 = "\xA0")), I.isStrikethrough() && B2.push("xterm-strikethrough"), W4 && (C3.style.textDecoration = "underline");
              let $ = I.getFgColor(), j2 = I.getFgColorMode(), z2 = I.getBgColor(), K = I.getBgColorMode();
              const q2 = !!I.isInverse();
              if (q2) {
                const e5 = $;
                $ = z2, z2 = e5;
                const t8 = j2;
                j2 = K, K = t8;
              }
              let V2, G, X, J = false;
              switch (this._decorationService.forEachDecorationAtCell(M3, t7, void 0, (e5) => {
                "top" !== e5.options.layer && J || (e5.backgroundColorRGB && (K = 50331648, z2 = e5.backgroundColorRGB.rgba >> 8 & 16777215, V2 = e5.backgroundColorRGB), e5.foregroundColorRGB && (j2 = 50331648, $ = e5.foregroundColorRGB.rgba >> 8 & 16777215, G = e5.foregroundColorRGB), J = "top" === e5.options.layer);
              }), !J && H2 && (V2 = this._coreBrowserService.isFocused ? S2.selectionBackgroundOpaque : S2.selectionInactiveBackgroundOpaque, z2 = V2.rgba >> 8 & 16777215, K = 50331648, J = true, S2.selectionForeground && (j2 = 50331648, $ = S2.selectionForeground.rgba >> 8 & 16777215, G = S2.selectionForeground)), J && B2.push("xterm-decoration-top"), K) {
                case 16777216:
                case 33554432:
                  X = S2.ansi[z2], B2.push(`xterm-bg-${z2}`);
                  break;
                case 50331648:
                  X = c12.rgba.toColor(z2 >> 16, z2 >> 8 & 255, 255 & z2), this._addStyle(C3, `background-color:#${v4((z2 >>> 0).toString(16), "0", 6)}`);
                  break;
                default:
                  q2 ? (X = S2.foreground, B2.push(`xterm-bg-${n8.INVERTED_DEFAULT_COLOR}`)) : X = S2.background;
              }
              switch (V2 || I.isDim() && (V2 = c12.color.multiplyOpacity(X, 0.5)), j2) {
                case 16777216:
                case 33554432:
                  I.isBold() && $ < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && ($ += 8), this._applyMinimumContrast(C3, X, S2.ansi[$], I, V2, void 0) || B2.push(`xterm-fg-${$}`);
                  break;
                case 50331648:
                  const e5 = c12.rgba.toColor($ >> 16 & 255, $ >> 8 & 255, 255 & $);
                  this._applyMinimumContrast(C3, X, e5, I, V2, G) || this._addStyle(C3, `color:#${v4($.toString(16), "0", 6)}`);
                  break;
                default:
                  this._applyMinimumContrast(C3, X, S2.foreground, I, V2, void 0) || q2 && B2.push(`xterm-fg-${n8.INVERTED_DEFAULT_COLOR}`);
              }
              B2.length && (C3.className = B2.join(" "), B2.length = 0), F3 || O2 || U ? C3.textContent = w3 : y4++, A2 !== this.defaultSpacing && (C3.style.letterSpacing = `${A2}px`), g6.push(C3), M3 = P2;
            }
            return C3 && y4 && (C3.textContent = w3), g6;
          }
          _applyMinimumContrast(e4, t7, i9, s12, r5, n9) {
            if (1 === this._optionsService.rawOptions.minimumContrastRatio || (0, _4.excludeFromContrastRatioDemands)(s12.getCode()))
              return false;
            const o6 = this._getContrastCache(s12);
            let a9;
            if (r5 || n9 || (a9 = o6.getColor(t7.rgba, i9.rgba)), void 0 === a9) {
              const e5 = this._optionsService.rawOptions.minimumContrastRatio / (s12.isDim() ? 2 : 1);
              a9 = c12.color.ensureContrastRatio(r5 || t7, n9 || i9, e5), o6.setColor((r5 || t7).rgba, (n9 || i9).rgba, null != a9 ? a9 : null);
            }
            return !!a9 && (this._addStyle(e4, `color:${a9.css}`), true);
          }
          _getContrastCache(e4) {
            return e4.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
          }
          _addStyle(e4, t7) {
            e4.setAttribute("style", `${e4.getAttribute("style") || ""}${t7};`);
          }
          _isCellInSelection(e4, t7) {
            const i9 = this._selectionStart, s12 = this._selectionEnd;
            return !(!i9 || !s12) && (this._columnSelectMode ? i9[0] <= s12[0] ? e4 >= i9[0] && t7 >= i9[1] && e4 < s12[0] && t7 <= s12[1] : e4 < i9[0] && t7 >= i9[1] && e4 >= s12[0] && t7 <= s12[1] : t7 > i9[1] && t7 < s12[1] || i9[1] === s12[1] && t7 === i9[1] && e4 >= i9[0] && e4 < s12[0] || i9[1] < s12[1] && t7 === s12[1] && e4 < s12[0] || i9[1] < s12[1] && t7 === i9[1] && e4 >= i9[0]);
          }
        };
        function v4(e4, t7, i9) {
          for (; e4.length < i9; )
            e4 = t7 + e4;
          return e4;
        }
        t6.DomRendererRowFactory = f5 = s11([r4(1, l9.ICharacterJoinerService), r4(2, h3.IOptionsService), r4(3, l9.ICoreBrowserService), r4(4, h3.ICoreService), r4(5, h3.IDecorationService), r4(6, l9.IThemeService)], f5);
      }, 2550: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.WidthCache = void 0, t6.WidthCache = class {
          constructor(e4) {
            this._flat = new Float32Array(256), this._font = "", this._fontSize = 0, this._weight = "normal", this._weightBold = "bold", this._measureElements = [], this._container = e4.createElement("div"), this._container.style.position = "absolute", this._container.style.top = "-50000px", this._container.style.width = "50000px", this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
            const t7 = e4.createElement("span"), i8 = e4.createElement("span");
            i8.style.fontWeight = "bold";
            const s11 = e4.createElement("span");
            s11.style.fontStyle = "italic";
            const r4 = e4.createElement("span");
            r4.style.fontWeight = "bold", r4.style.fontStyle = "italic", this._measureElements = [t7, i8, s11, r4], this._container.appendChild(t7), this._container.appendChild(i8), this._container.appendChild(s11), this._container.appendChild(r4), e4.body.appendChild(this._container), this.clear();
          }
          dispose() {
            this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
          }
          clear() {
            this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
          }
          setFont(e4, t7, i8, s11) {
            e4 === this._font && t7 === this._fontSize && i8 === this._weight && s11 === this._weightBold || (this._font = e4, this._fontSize = t7, this._weight = i8, this._weightBold = s11, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i8}`, this._measureElements[1].style.fontWeight = `${s11}`, this._measureElements[2].style.fontWeight = `${i8}`, this._measureElements[3].style.fontWeight = `${s11}`, this.clear());
          }
          get(e4, t7, i8) {
            let s11 = 0;
            if (!t7 && !i8 && 1 === e4.length && (s11 = e4.charCodeAt(0)) < 256)
              return -9999 !== this._flat[s11] ? this._flat[s11] : this._flat[s11] = this._measure(e4, 0);
            let r4 = e4;
            t7 && (r4 += "B"), i8 && (r4 += "I");
            let n8 = this._holey.get(r4);
            if (void 0 === n8) {
              let s12 = 0;
              t7 && (s12 |= 1), i8 && (s12 |= 2), n8 = this._measure(e4, s12), this._holey.set(r4, n8);
            }
            return n8;
          }
          _measure(e4, t7) {
            const i8 = this._measureElements[t7];
            return i8.textContent = e4.repeat(32), i8.offsetWidth / 32;
          }
        };
      }, 2223: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.TEXT_BASELINE = t6.DIM_OPACITY = t6.INVERTED_DEFAULT_COLOR = void 0;
        const s11 = i8(6114);
        t6.INVERTED_DEFAULT_COLOR = 257, t6.DIM_OPACITY = 0.5, t6.TEXT_BASELINE = s11.isFirefox || s11.isLegacyEdge ? "bottom" : "ideographic";
      }, 6171: (e3, t6) => {
        function i8(e4) {
          return 57508 <= e4 && e4 <= 57558;
        }
        Object.defineProperty(t6, "__esModule", { value: true }), t6.createRenderDimensions = t6.excludeFromContrastRatioDemands = t6.isRestrictedPowerlineGlyph = t6.isPowerlineGlyph = t6.throwIfFalsy = void 0, t6.throwIfFalsy = function(e4) {
          if (!e4)
            throw new Error("value must not be falsy");
          return e4;
        }, t6.isPowerlineGlyph = i8, t6.isRestrictedPowerlineGlyph = function(e4) {
          return 57520 <= e4 && e4 <= 57527;
        }, t6.excludeFromContrastRatioDemands = function(e4) {
          return i8(e4) || function(e5) {
            return 9472 <= e5 && e5 <= 9631;
          }(e4);
        }, t6.createRenderDimensions = function() {
          return { css: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 } }, device: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 }, char: { width: 0, height: 0, left: 0, top: 0 } } };
        };
      }, 456: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.SelectionModel = void 0, t6.SelectionModel = class {
          constructor(e4) {
            this._bufferService = e4, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          clearSelection() {
            this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          get finalSelectionStart() {
            return this.isSelectAllActive ? [0, 0] : this.selectionEnd && this.selectionStart && this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
          }
          get finalSelectionEnd() {
            if (this.isSelectAllActive)
              return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
            if (this.selectionStart) {
              if (!this.selectionEnd || this.areSelectionValuesReversed()) {
                const e4 = this.selectionStart[0] + this.selectionStartLength;
                return e4 > this._bufferService.cols ? e4 % this._bufferService.cols == 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(e4 / this._bufferService.cols) - 1] : [e4 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e4 / this._bufferService.cols)] : [e4, this.selectionStart[1]];
              }
              if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
                const e4 = this.selectionStart[0] + this.selectionStartLength;
                return e4 > this._bufferService.cols ? [e4 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e4 / this._bufferService.cols)] : [Math.max(e4, this.selectionEnd[0]), this.selectionEnd[1]];
              }
              return this.selectionEnd;
            }
          }
          areSelectionValuesReversed() {
            const e4 = this.selectionStart, t7 = this.selectionEnd;
            return !(!e4 || !t7) && (e4[1] > t7[1] || e4[1] === t7[1] && e4[0] > t7[0]);
          }
          handleTrim(e4) {
            return this.selectionStart && (this.selectionStart[1] -= e4), this.selectionEnd && (this.selectionEnd[1] -= e4), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
          }
        };
      }, 428: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CharSizeService = void 0;
        const n8 = i8(2585), o5 = i8(8460), a8 = i8(844);
        let h3 = t6.CharSizeService = class extends a8.Disposable {
          get hasValidSize() {
            return this.width > 0 && this.height > 0;
          }
          constructor(e4, t7, i9) {
            super(), this._optionsService = i9, this.width = 0, this.height = 0, this._onCharSizeChange = this.register(new o5.EventEmitter()), this.onCharSizeChange = this._onCharSizeChange.event, this._measureStrategy = new c12(e4, t7, this._optionsService), this.register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], () => this.measure()));
          }
          measure() {
            const e4 = this._measureStrategy.measure();
            e4.width === this.width && e4.height === this.height || (this.width = e4.width, this.height = e4.height, this._onCharSizeChange.fire());
          }
        };
        t6.CharSizeService = h3 = s11([r4(2, n8.IOptionsService)], h3);
        class c12 {
          constructor(e4, t7, i9) {
            this._document = e4, this._parentElement = t7, this._optionsService = i9, this._result = { width: 0, height: 0 }, this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
          }
          measure() {
            this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`;
            const e4 = { height: Number(this._measureElement.offsetHeight), width: Number(this._measureElement.offsetWidth) };
            return 0 !== e4.width && 0 !== e4.height && (this._result.width = e4.width / 32, this._result.height = Math.ceil(e4.height)), this._result;
          }
        }
      }, 4269: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CharacterJoinerService = t6.JoinedCellData = void 0;
        const n8 = i8(3734), o5 = i8(643), a8 = i8(511), h3 = i8(2585);
        class c12 extends n8.AttributeData {
          constructor(e4, t7, i9) {
            super(), this.content = 0, this.combinedData = "", this.fg = e4.fg, this.bg = e4.bg, this.combinedData = t7, this._width = i9;
          }
          isCombined() {
            return 2097152;
          }
          getWidth() {
            return this._width;
          }
          getChars() {
            return this.combinedData;
          }
          getCode() {
            return 2097151;
          }
          setFromCharData(e4) {
            throw new Error("not implemented");
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t6.JoinedCellData = c12;
        let l9 = t6.CharacterJoinerService = class e4 {
          constructor(e5) {
            this._bufferService = e5, this._characterJoiners = [], this._nextCharacterJoinerId = 0, this._workCell = new a8.CellData();
          }
          register(e5) {
            const t7 = { id: this._nextCharacterJoinerId++, handler: e5 };
            return this._characterJoiners.push(t7), t7.id;
          }
          deregister(e5) {
            for (let t7 = 0; t7 < this._characterJoiners.length; t7++)
              if (this._characterJoiners[t7].id === e5)
                return this._characterJoiners.splice(t7, 1), true;
            return false;
          }
          getJoinedCharacters(e5) {
            if (0 === this._characterJoiners.length)
              return [];
            const t7 = this._bufferService.buffer.lines.get(e5);
            if (!t7 || 0 === t7.length)
              return [];
            const i9 = [], s12 = t7.translateToString(true);
            let r5 = 0, n9 = 0, a9 = 0, h4 = t7.getFg(0), c13 = t7.getBg(0);
            for (let e6 = 0; e6 < t7.getTrimmedLength(); e6++)
              if (t7.loadCell(e6, this._workCell), 0 !== this._workCell.getWidth()) {
                if (this._workCell.fg !== h4 || this._workCell.bg !== c13) {
                  if (e6 - r5 > 1) {
                    const e7 = this._getJoinedRanges(s12, a9, n9, t7, r5);
                    for (let t8 = 0; t8 < e7.length; t8++)
                      i9.push(e7[t8]);
                  }
                  r5 = e6, a9 = n9, h4 = this._workCell.fg, c13 = this._workCell.bg;
                }
                n9 += this._workCell.getChars().length || o5.WHITESPACE_CELL_CHAR.length;
              }
            if (this._bufferService.cols - r5 > 1) {
              const e6 = this._getJoinedRanges(s12, a9, n9, t7, r5);
              for (let t8 = 0; t8 < e6.length; t8++)
                i9.push(e6[t8]);
            }
            return i9;
          }
          _getJoinedRanges(t7, i9, s12, r5, n9) {
            const o6 = t7.substring(i9, s12);
            let a9 = [];
            try {
              a9 = this._characterJoiners[0].handler(o6);
            } catch (e5) {
              console.error(e5);
            }
            for (let t8 = 1; t8 < this._characterJoiners.length; t8++)
              try {
                const i10 = this._characterJoiners[t8].handler(o6);
                for (let t9 = 0; t9 < i10.length; t9++)
                  e4._mergeRanges(a9, i10[t9]);
              } catch (e5) {
                console.error(e5);
              }
            return this._stringRangesToCellRanges(a9, r5, n9), a9;
          }
          _stringRangesToCellRanges(e5, t7, i9) {
            let s12 = 0, r5 = false, n9 = 0, a9 = e5[s12];
            if (a9) {
              for (let h4 = i9; h4 < this._bufferService.cols; h4++) {
                const i10 = t7.getWidth(h4), c13 = t7.getString(h4).length || o5.WHITESPACE_CELL_CHAR.length;
                if (0 !== i10) {
                  if (!r5 && a9[0] <= n9 && (a9[0] = h4, r5 = true), a9[1] <= n9) {
                    if (a9[1] = h4, a9 = e5[++s12], !a9)
                      break;
                    a9[0] <= n9 ? (a9[0] = h4, r5 = true) : r5 = false;
                  }
                  n9 += c13;
                }
              }
              a9 && (a9[1] = this._bufferService.cols);
            }
          }
          static _mergeRanges(e5, t7) {
            let i9 = false;
            for (let s12 = 0; s12 < e5.length; s12++) {
              const r5 = e5[s12];
              if (i9) {
                if (t7[1] <= r5[0])
                  return e5[s12 - 1][1] = t7[1], e5;
                if (t7[1] <= r5[1])
                  return e5[s12 - 1][1] = Math.max(t7[1], r5[1]), e5.splice(s12, 1), e5;
                e5.splice(s12, 1), s12--;
              } else {
                if (t7[1] <= r5[0])
                  return e5.splice(s12, 0, t7), e5;
                if (t7[1] <= r5[1])
                  return r5[0] = Math.min(t7[0], r5[0]), e5;
                t7[0] < r5[1] && (r5[0] = Math.min(t7[0], r5[0]), i9 = true);
              }
            }
            return i9 ? e5[e5.length - 1][1] = t7[1] : e5.push(t7), e5;
          }
        };
        t6.CharacterJoinerService = l9 = s11([r4(0, h3.IBufferService)], l9);
      }, 5114: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CoreBrowserService = void 0, t6.CoreBrowserService = class {
          constructor(e4, t7) {
            this._textarea = e4, this.window = t7, this._isFocused = false, this._cachedIsFocused = void 0, this._textarea.addEventListener("focus", () => this._isFocused = true), this._textarea.addEventListener("blur", () => this._isFocused = false);
          }
          get dpr() {
            return this.window.devicePixelRatio;
          }
          get isFocused() {
            return void 0 === this._cachedIsFocused && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask(() => this._cachedIsFocused = void 0)), this._cachedIsFocused;
          }
        };
      }, 8934: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.MouseService = void 0;
        const n8 = i8(4725), o5 = i8(9806);
        let a8 = t6.MouseService = class {
          constructor(e4, t7) {
            this._renderService = e4, this._charSizeService = t7;
          }
          getCoords(e4, t7, i9, s12, r5) {
            return (0, o5.getCoords)(window, e4, t7, i9, s12, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, r5);
          }
          getMouseReportCoords(e4, t7) {
            const i9 = (0, o5.getCoordsRelativeToElement)(window, e4, t7);
            if (this._charSizeService.hasValidSize)
              return i9[0] = Math.min(Math.max(i9[0], 0), this._renderService.dimensions.css.canvas.width - 1), i9[1] = Math.min(Math.max(i9[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i9[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i9[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i9[0]), y: Math.floor(i9[1]) };
          }
        };
        t6.MouseService = a8 = s11([r4(0, n8.IRenderService), r4(1, n8.ICharSizeService)], a8);
      }, 3230: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.RenderService = void 0;
        const n8 = i8(3656), o5 = i8(6193), a8 = i8(5596), h3 = i8(4725), c12 = i8(8460), l9 = i8(844), d7 = i8(7226), _4 = i8(2585);
        let u9 = t6.RenderService = class extends l9.Disposable {
          get dimensions() {
            return this._renderer.value.dimensions;
          }
          constructor(e4, t7, i9, s12, r5, h4, _5, u10) {
            if (super(), this._rowCount = e4, this._charSizeService = s12, this._renderer = this.register(new l9.MutableDisposable()), this._pausedResizeTask = new d7.DebouncedIdleTask(), this._isPaused = false, this._needsFullRefresh = false, this._isNextRenderRedrawOnly = true, this._needsSelectionRefresh = false, this._canvasWidth = 0, this._canvasHeight = 0, this._selectionState = { start: void 0, end: void 0, columnSelectMode: false }, this._onDimensionsChange = this.register(new c12.EventEmitter()), this.onDimensionsChange = this._onDimensionsChange.event, this._onRenderedViewportChange = this.register(new c12.EventEmitter()), this.onRenderedViewportChange = this._onRenderedViewportChange.event, this._onRender = this.register(new c12.EventEmitter()), this.onRender = this._onRender.event, this._onRefreshRequest = this.register(new c12.EventEmitter()), this.onRefreshRequest = this._onRefreshRequest.event, this._renderDebouncer = new o5.RenderDebouncer(_5.window, (e5, t8) => this._renderRows(e5, t8)), this.register(this._renderDebouncer), this._screenDprMonitor = new a8.ScreenDprMonitor(_5.window), this._screenDprMonitor.setListener(() => this.handleDevicePixelRatioChange()), this.register(this._screenDprMonitor), this.register(h4.onResize(() => this._fullRefresh())), this.register(h4.buffers.onBufferActivate(() => {
              var e5;
              return null === (e5 = this._renderer.value) || void 0 === e5 ? void 0 : e5.clear();
            })), this.register(i9.onOptionChange(() => this._handleOptionsChanged())), this.register(this._charSizeService.onCharSizeChange(() => this.handleCharSizeChanged())), this.register(r5.onDecorationRegistered(() => this._fullRefresh())), this.register(r5.onDecorationRemoved(() => this._fullRefresh())), this.register(i9.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio"], () => {
              this.clear(), this.handleResize(h4.cols, h4.rows), this._fullRefresh();
            })), this.register(i9.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(h4.buffer.y, h4.buffer.y, true))), this.register((0, n8.addDisposableDomListener)(_5.window, "resize", () => this.handleDevicePixelRatioChange())), this.register(u10.onChangeColors(() => this._fullRefresh())), "IntersectionObserver" in _5.window) {
              const e5 = new _5.window.IntersectionObserver((e6) => this._handleIntersectionChange(e6[e6.length - 1]), { threshold: 0 });
              e5.observe(t7), this.register({ dispose: () => e5.disconnect() });
            }
          }
          _handleIntersectionChange(e4) {
            this._isPaused = void 0 === e4.isIntersecting ? 0 === e4.intersectionRatio : !e4.isIntersecting, this._isPaused || this._charSizeService.hasValidSize || this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
          }
          refreshRows(e4, t7, i9 = false) {
            this._isPaused ? this._needsFullRefresh = true : (i9 || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e4, t7, this._rowCount));
          }
          _renderRows(e4, t7) {
            this._renderer.value && (e4 = Math.min(e4, this._rowCount - 1), t7 = Math.min(t7, this._rowCount - 1), this._renderer.value.renderRows(e4, t7), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e4, end: t7 }), this._onRender.fire({ start: e4, end: t7 }), this._isNextRenderRedrawOnly = true);
          }
          resize(e4, t7) {
            this._rowCount = t7, this._fireOnCanvasResize();
          }
          _handleOptionsChanged() {
            this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
          }
          _fireOnCanvasResize() {
            this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
          }
          hasRenderer() {
            return !!this._renderer.value;
          }
          setRenderer(e4) {
            this._renderer.value = e4, this._renderer.value.onRequestRedraw((e5) => this.refreshRows(e5.start, e5.end, true)), this._needsSelectionRefresh = true, this._fullRefresh();
          }
          addRefreshCallback(e4) {
            return this._renderDebouncer.addRefreshCallback(e4);
          }
          _fullRefresh() {
            this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
          }
          clearTextureAtlas() {
            var e4, t7;
            this._renderer.value && (null === (t7 = (e4 = this._renderer.value).clearTextureAtlas) || void 0 === t7 || t7.call(e4), this._fullRefresh());
          }
          handleDevicePixelRatioChange() {
            this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
          }
          handleResize(e4, t7) {
            this._renderer.value && (this._isPaused ? this._pausedResizeTask.set(() => this._renderer.value.handleResize(e4, t7)) : this._renderer.value.handleResize(e4, t7), this._fullRefresh());
          }
          handleCharSizeChanged() {
            var e4;
            null === (e4 = this._renderer.value) || void 0 === e4 || e4.handleCharSizeChanged();
          }
          handleBlur() {
            var e4;
            null === (e4 = this._renderer.value) || void 0 === e4 || e4.handleBlur();
          }
          handleFocus() {
            var e4;
            null === (e4 = this._renderer.value) || void 0 === e4 || e4.handleFocus();
          }
          handleSelectionChanged(e4, t7, i9) {
            var s12;
            this._selectionState.start = e4, this._selectionState.end = t7, this._selectionState.columnSelectMode = i9, null === (s12 = this._renderer.value) || void 0 === s12 || s12.handleSelectionChanged(e4, t7, i9);
          }
          handleCursorMove() {
            var e4;
            null === (e4 = this._renderer.value) || void 0 === e4 || e4.handleCursorMove();
          }
          clear() {
            var e4;
            null === (e4 = this._renderer.value) || void 0 === e4 || e4.clear();
          }
        };
        t6.RenderService = u9 = s11([r4(2, _4.IOptionsService), r4(3, h3.ICharSizeService), r4(4, _4.IDecorationService), r4(5, _4.IBufferService), r4(6, h3.ICoreBrowserService), r4(7, h3.IThemeService)], u9);
      }, 9312: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.SelectionService = void 0;
        const n8 = i8(9806), o5 = i8(9504), a8 = i8(456), h3 = i8(4725), c12 = i8(8460), l9 = i8(844), d7 = i8(6114), _4 = i8(4841), u9 = i8(511), f5 = i8(2585), v4 = String.fromCharCode(160), p5 = new RegExp(v4, "g");
        let g6 = t6.SelectionService = class extends l9.Disposable {
          constructor(e4, t7, i9, s12, r5, n9, o6, h4, d8) {
            super(), this._element = e4, this._screenElement = t7, this._linkifier = i9, this._bufferService = s12, this._coreService = r5, this._mouseService = n9, this._optionsService = o6, this._renderService = h4, this._coreBrowserService = d8, this._dragScrollAmount = 0, this._enabled = true, this._workCell = new u9.CellData(), this._mouseDownTimeStamp = 0, this._oldHasSelection = false, this._oldSelectionStart = void 0, this._oldSelectionEnd = void 0, this._onLinuxMouseSelection = this.register(new c12.EventEmitter()), this.onLinuxMouseSelection = this._onLinuxMouseSelection.event, this._onRedrawRequest = this.register(new c12.EventEmitter()), this.onRequestRedraw = this._onRedrawRequest.event, this._onSelectionChange = this.register(new c12.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onRequestScrollLines = this.register(new c12.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this._mouseMoveListener = (e5) => this._handleMouseMove(e5), this._mouseUpListener = (e5) => this._handleMouseUp(e5), this._coreService.onUserInput(() => {
              this.hasSelection && this.clearSelection();
            }), this._trimListener = this._bufferService.buffer.lines.onTrim((e5) => this._handleTrim(e5)), this.register(this._bufferService.buffers.onBufferActivate((e5) => this._handleBufferActivate(e5))), this.enable(), this._model = new a8.SelectionModel(this._bufferService), this._activeSelectionMode = 0, this.register((0, l9.toDisposable)(() => {
              this._removeMouseDownListeners();
            }));
          }
          reset() {
            this.clearSelection();
          }
          disable() {
            this.clearSelection(), this._enabled = false;
          }
          enable() {
            this._enabled = true;
          }
          get selectionStart() {
            return this._model.finalSelectionStart;
          }
          get selectionEnd() {
            return this._model.finalSelectionEnd;
          }
          get hasSelection() {
            const e4 = this._model.finalSelectionStart, t7 = this._model.finalSelectionEnd;
            return !(!e4 || !t7 || e4[0] === t7[0] && e4[1] === t7[1]);
          }
          get selectionText() {
            const e4 = this._model.finalSelectionStart, t7 = this._model.finalSelectionEnd;
            if (!e4 || !t7)
              return "";
            const i9 = this._bufferService.buffer, s12 = [];
            if (3 === this._activeSelectionMode) {
              if (e4[0] === t7[0])
                return "";
              const r5 = e4[0] < t7[0] ? e4[0] : t7[0], n9 = e4[0] < t7[0] ? t7[0] : e4[0];
              for (let o6 = e4[1]; o6 <= t7[1]; o6++) {
                const e5 = i9.translateBufferLineToString(o6, true, r5, n9);
                s12.push(e5);
              }
            } else {
              const r5 = e4[1] === t7[1] ? t7[0] : void 0;
              s12.push(i9.translateBufferLineToString(e4[1], true, e4[0], r5));
              for (let r6 = e4[1] + 1; r6 <= t7[1] - 1; r6++) {
                const e5 = i9.lines.get(r6), t8 = i9.translateBufferLineToString(r6, true);
                (null == e5 ? void 0 : e5.isWrapped) ? s12[s12.length - 1] += t8 : s12.push(t8);
              }
              if (e4[1] !== t7[1]) {
                const e5 = i9.lines.get(t7[1]), r6 = i9.translateBufferLineToString(t7[1], true, 0, t7[0]);
                e5 && e5.isWrapped ? s12[s12.length - 1] += r6 : s12.push(r6);
              }
            }
            return s12.map((e5) => e5.replace(p5, " ")).join(d7.isWindows ? "\r\n" : "\n");
          }
          clearSelection() {
            this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
          }
          refresh(e4) {
            this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._refresh())), d7.isLinux && e4 && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
          }
          _refresh() {
            this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: 3 === this._activeSelectionMode });
          }
          _isClickInSelection(e4) {
            const t7 = this._getMouseBufferCoords(e4), i9 = this._model.finalSelectionStart, s12 = this._model.finalSelectionEnd;
            return !!(i9 && s12 && t7) && this._areCoordsInSelection(t7, i9, s12);
          }
          isCellInSelection(e4, t7) {
            const i9 = this._model.finalSelectionStart, s12 = this._model.finalSelectionEnd;
            return !(!i9 || !s12) && this._areCoordsInSelection([e4, t7], i9, s12);
          }
          _areCoordsInSelection(e4, t7, i9) {
            return e4[1] > t7[1] && e4[1] < i9[1] || t7[1] === i9[1] && e4[1] === t7[1] && e4[0] >= t7[0] && e4[0] < i9[0] || t7[1] < i9[1] && e4[1] === i9[1] && e4[0] < i9[0] || t7[1] < i9[1] && e4[1] === t7[1] && e4[0] >= t7[0];
          }
          _selectWordAtCursor(e4, t7) {
            var i9, s12;
            const r5 = null === (s12 = null === (i9 = this._linkifier.currentLink) || void 0 === i9 ? void 0 : i9.link) || void 0 === s12 ? void 0 : s12.range;
            if (r5)
              return this._model.selectionStart = [r5.start.x - 1, r5.start.y - 1], this._model.selectionStartLength = (0, _4.getRangeLength)(r5, this._bufferService.cols), this._model.selectionEnd = void 0, true;
            const n9 = this._getMouseBufferCoords(e4);
            return !!n9 && (this._selectWordAt(n9, t7), this._model.selectionEnd = void 0, true);
          }
          selectAll() {
            this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
          }
          selectLines(e4, t7) {
            this._model.clearSelection(), e4 = Math.max(e4, 0), t7 = Math.min(t7, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e4], this._model.selectionEnd = [this._bufferService.cols, t7], this.refresh(), this._onSelectionChange.fire();
          }
          _handleTrim(e4) {
            this._model.handleTrim(e4) && this.refresh();
          }
          _getMouseBufferCoords(e4) {
            const t7 = this._mouseService.getCoords(e4, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
            if (t7)
              return t7[0]--, t7[1]--, t7[1] += this._bufferService.buffer.ydisp, t7;
          }
          _getMouseEventScrollAmount(e4) {
            let t7 = (0, n8.getCoordsRelativeToElement)(this._coreBrowserService.window, e4, this._screenElement)[1];
            const i9 = this._renderService.dimensions.css.canvas.height;
            return t7 >= 0 && t7 <= i9 ? 0 : (t7 > i9 && (t7 -= i9), t7 = Math.min(Math.max(t7, -50), 50), t7 /= 50, t7 / Math.abs(t7) + Math.round(14 * t7));
          }
          shouldForceSelection(e4) {
            return d7.isMac ? e4.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e4.shiftKey;
          }
          handleMouseDown(e4) {
            if (this._mouseDownTimeStamp = e4.timeStamp, (2 !== e4.button || !this.hasSelection) && 0 === e4.button) {
              if (!this._enabled) {
                if (!this.shouldForceSelection(e4))
                  return;
                e4.stopPropagation();
              }
              e4.preventDefault(), this._dragScrollAmount = 0, this._enabled && e4.shiftKey ? this._handleIncrementalClick(e4) : 1 === e4.detail ? this._handleSingleClick(e4) : 2 === e4.detail ? this._handleDoubleClick(e4) : 3 === e4.detail && this._handleTripleClick(e4), this._addMouseDownListeners(), this.refresh(true);
            }
          }
          _addMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval(() => this._dragScroll(), 50);
          }
          _removeMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
          }
          _handleIncrementalClick(e4) {
            this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e4));
          }
          _handleSingleClick(e4) {
            if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e4) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e4), !this._model.selectionStart)
              return;
            this._model.selectionEnd = void 0;
            const t7 = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
            t7 && t7.length !== this._model.selectionStart[0] && 0 === t7.hasWidth(this._model.selectionStart[0]) && this._model.selectionStart[0]++;
          }
          _handleDoubleClick(e4) {
            this._selectWordAtCursor(e4, true) && (this._activeSelectionMode = 1);
          }
          _handleTripleClick(e4) {
            const t7 = this._getMouseBufferCoords(e4);
            t7 && (this._activeSelectionMode = 2, this._selectLineAt(t7[1]));
          }
          shouldColumnSelect(e4) {
            return e4.altKey && !(d7.isMac && this._optionsService.rawOptions.macOptionClickForcesSelection);
          }
          _handleMouseMove(e4) {
            if (e4.stopImmediatePropagation(), !this._model.selectionStart)
              return;
            const t7 = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
            if (this._model.selectionEnd = this._getMouseBufferCoords(e4), !this._model.selectionEnd)
              return void this.refresh(true);
            2 === this._activeSelectionMode ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : 1 === this._activeSelectionMode && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e4), 3 !== this._activeSelectionMode && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
            const i9 = this._bufferService.buffer;
            if (this._model.selectionEnd[1] < i9.lines.length) {
              const e5 = i9.lines.get(this._model.selectionEnd[1]);
              e5 && 0 === e5.hasWidth(this._model.selectionEnd[0]) && this._model.selectionEnd[0]++;
            }
            t7 && t7[0] === this._model.selectionEnd[0] && t7[1] === this._model.selectionEnd[1] || this.refresh(true);
          }
          _dragScroll() {
            if (this._model.selectionEnd && this._model.selectionStart && this._dragScrollAmount) {
              this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
              const e4 = this._bufferService.buffer;
              this._dragScrollAmount > 0 ? (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e4.ydisp + this._bufferService.rows, e4.lines.length - 1)) : (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e4.ydisp), this.refresh();
            }
          }
          _handleMouseUp(e4) {
            const t7 = e4.timeStamp - this._mouseDownTimeStamp;
            if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && t7 < 500 && e4.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
              if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
                const t8 = this._mouseService.getCoords(e4, this._element, this._bufferService.cols, this._bufferService.rows, false);
                if (t8 && void 0 !== t8[0] && void 0 !== t8[1]) {
                  const e5 = (0, o5.moveToCellSequence)(t8[0] - 1, t8[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
                  this._coreService.triggerDataEvent(e5, true);
                }
              }
            } else
              this._fireEventIfSelectionChanged();
          }
          _fireEventIfSelectionChanged() {
            const e4 = this._model.finalSelectionStart, t7 = this._model.finalSelectionEnd, i9 = !(!e4 || !t7 || e4[0] === t7[0] && e4[1] === t7[1]);
            i9 ? e4 && t7 && (this._oldSelectionStart && this._oldSelectionEnd && e4[0] === this._oldSelectionStart[0] && e4[1] === this._oldSelectionStart[1] && t7[0] === this._oldSelectionEnd[0] && t7[1] === this._oldSelectionEnd[1] || this._fireOnSelectionChange(e4, t7, i9)) : this._oldHasSelection && this._fireOnSelectionChange(e4, t7, i9);
          }
          _fireOnSelectionChange(e4, t7, i9) {
            this._oldSelectionStart = e4, this._oldSelectionEnd = t7, this._oldHasSelection = i9, this._onSelectionChange.fire();
          }
          _handleBufferActivate(e4) {
            this.clearSelection(), this._trimListener.dispose(), this._trimListener = e4.activeBuffer.lines.onTrim((e5) => this._handleTrim(e5));
          }
          _convertViewportColToCharacterIndex(e4, t7) {
            let i9 = t7;
            for (let s12 = 0; t7 >= s12; s12++) {
              const r5 = e4.loadCell(s12, this._workCell).getChars().length;
              0 === this._workCell.getWidth() ? i9-- : r5 > 1 && t7 !== s12 && (i9 += r5 - 1);
            }
            return i9;
          }
          setSelection(e4, t7, i9) {
            this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e4, t7], this._model.selectionStartLength = i9, this.refresh(), this._fireEventIfSelectionChanged();
          }
          rightClickSelect(e4) {
            this._isClickInSelection(e4) || (this._selectWordAtCursor(e4, false) && this.refresh(true), this._fireEventIfSelectionChanged());
          }
          _getWordAt(e4, t7, i9 = true, s12 = true) {
            if (e4[0] >= this._bufferService.cols)
              return;
            const r5 = this._bufferService.buffer, n9 = r5.lines.get(e4[1]);
            if (!n9)
              return;
            const o6 = r5.translateBufferLineToString(e4[1], false);
            let a9 = this._convertViewportColToCharacterIndex(n9, e4[0]), h4 = a9;
            const c13 = e4[0] - a9;
            let l10 = 0, d8 = 0, _5 = 0, u10 = 0;
            if (" " === o6.charAt(a9)) {
              for (; a9 > 0 && " " === o6.charAt(a9 - 1); )
                a9--;
              for (; h4 < o6.length && " " === o6.charAt(h4 + 1); )
                h4++;
            } else {
              let t8 = e4[0], i10 = e4[0];
              0 === n9.getWidth(t8) && (l10++, t8--), 2 === n9.getWidth(i10) && (d8++, i10++);
              const s13 = n9.getString(i10).length;
              for (s13 > 1 && (u10 += s13 - 1, h4 += s13 - 1); t8 > 0 && a9 > 0 && !this._isCharWordSeparator(n9.loadCell(t8 - 1, this._workCell)); ) {
                n9.loadCell(t8 - 1, this._workCell);
                const e5 = this._workCell.getChars().length;
                0 === this._workCell.getWidth() ? (l10++, t8--) : e5 > 1 && (_5 += e5 - 1, a9 -= e5 - 1), a9--, t8--;
              }
              for (; i10 < n9.length && h4 + 1 < o6.length && !this._isCharWordSeparator(n9.loadCell(i10 + 1, this._workCell)); ) {
                n9.loadCell(i10 + 1, this._workCell);
                const e5 = this._workCell.getChars().length;
                2 === this._workCell.getWidth() ? (d8++, i10++) : e5 > 1 && (u10 += e5 - 1, h4 += e5 - 1), h4++, i10++;
              }
            }
            h4++;
            let f6 = a9 + c13 - l10 + _5, v5 = Math.min(this._bufferService.cols, h4 - a9 + l10 + d8 - _5 - u10);
            if (t7 || "" !== o6.slice(a9, h4).trim()) {
              if (i9 && 0 === f6 && 32 !== n9.getCodePoint(0)) {
                const t8 = r5.lines.get(e4[1] - 1);
                if (t8 && n9.isWrapped && 32 !== t8.getCodePoint(this._bufferService.cols - 1)) {
                  const t9 = this._getWordAt([this._bufferService.cols - 1, e4[1] - 1], false, true, false);
                  if (t9) {
                    const e5 = this._bufferService.cols - t9.start;
                    f6 -= e5, v5 += e5;
                  }
                }
              }
              if (s12 && f6 + v5 === this._bufferService.cols && 32 !== n9.getCodePoint(this._bufferService.cols - 1)) {
                const t8 = r5.lines.get(e4[1] + 1);
                if ((null == t8 ? void 0 : t8.isWrapped) && 32 !== t8.getCodePoint(0)) {
                  const t9 = this._getWordAt([0, e4[1] + 1], false, false, true);
                  t9 && (v5 += t9.length);
                }
              }
              return { start: f6, length: v5 };
            }
          }
          _selectWordAt(e4, t7) {
            const i9 = this._getWordAt(e4, t7);
            if (i9) {
              for (; i9.start < 0; )
                i9.start += this._bufferService.cols, e4[1]--;
              this._model.selectionStart = [i9.start, e4[1]], this._model.selectionStartLength = i9.length;
            }
          }
          _selectToWordAt(e4) {
            const t7 = this._getWordAt(e4, true);
            if (t7) {
              let i9 = e4[1];
              for (; t7.start < 0; )
                t7.start += this._bufferService.cols, i9--;
              if (!this._model.areSelectionValuesReversed())
                for (; t7.start + t7.length > this._bufferService.cols; )
                  t7.length -= this._bufferService.cols, i9++;
              this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? t7.start : t7.start + t7.length, i9];
            }
          }
          _isCharWordSeparator(e4) {
            return 0 !== e4.getWidth() && this._optionsService.rawOptions.wordSeparator.indexOf(e4.getChars()) >= 0;
          }
          _selectLineAt(e4) {
            const t7 = this._bufferService.buffer.getWrappedRangeForLine(e4), i9 = { start: { x: 0, y: t7.first }, end: { x: this._bufferService.cols - 1, y: t7.last } };
            this._model.selectionStart = [0, t7.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = (0, _4.getRangeLength)(i9, this._bufferService.cols);
          }
        };
        t6.SelectionService = g6 = s11([r4(3, f5.IBufferService), r4(4, f5.ICoreService), r4(5, h3.IMouseService), r4(6, f5.IOptionsService), r4(7, h3.IRenderService), r4(8, h3.ICoreBrowserService)], g6);
      }, 4725: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.IThemeService = t6.ICharacterJoinerService = t6.ISelectionService = t6.IRenderService = t6.IMouseService = t6.ICoreBrowserService = t6.ICharSizeService = void 0;
        const s11 = i8(8343);
        t6.ICharSizeService = (0, s11.createDecorator)("CharSizeService"), t6.ICoreBrowserService = (0, s11.createDecorator)("CoreBrowserService"), t6.IMouseService = (0, s11.createDecorator)("MouseService"), t6.IRenderService = (0, s11.createDecorator)("RenderService"), t6.ISelectionService = (0, s11.createDecorator)("SelectionService"), t6.ICharacterJoinerService = (0, s11.createDecorator)("CharacterJoinerService"), t6.IThemeService = (0, s11.createDecorator)("ThemeService");
      }, 6731: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ThemeService = t6.DEFAULT_ANSI_COLORS = void 0;
        const n8 = i8(7239), o5 = i8(8055), a8 = i8(8460), h3 = i8(844), c12 = i8(2585), l9 = o5.css.toColor("#ffffff"), d7 = o5.css.toColor("#000000"), _4 = o5.css.toColor("#ffffff"), u9 = o5.css.toColor("#000000"), f5 = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 };
        t6.DEFAULT_ANSI_COLORS = Object.freeze((() => {
          const e4 = [o5.css.toColor("#2e3436"), o5.css.toColor("#cc0000"), o5.css.toColor("#4e9a06"), o5.css.toColor("#c4a000"), o5.css.toColor("#3465a4"), o5.css.toColor("#75507b"), o5.css.toColor("#06989a"), o5.css.toColor("#d3d7cf"), o5.css.toColor("#555753"), o5.css.toColor("#ef2929"), o5.css.toColor("#8ae234"), o5.css.toColor("#fce94f"), o5.css.toColor("#729fcf"), o5.css.toColor("#ad7fa8"), o5.css.toColor("#34e2e2"), o5.css.toColor("#eeeeec")], t7 = [0, 95, 135, 175, 215, 255];
          for (let i9 = 0; i9 < 216; i9++) {
            const s12 = t7[i9 / 36 % 6 | 0], r5 = t7[i9 / 6 % 6 | 0], n9 = t7[i9 % 6];
            e4.push({ css: o5.channels.toCss(s12, r5, n9), rgba: o5.channels.toRgba(s12, r5, n9) });
          }
          for (let t8 = 0; t8 < 24; t8++) {
            const i9 = 8 + 10 * t8;
            e4.push({ css: o5.channels.toCss(i9, i9, i9), rgba: o5.channels.toRgba(i9, i9, i9) });
          }
          return e4;
        })());
        let v4 = t6.ThemeService = class extends h3.Disposable {
          get colors() {
            return this._colors;
          }
          constructor(e4) {
            super(), this._optionsService = e4, this._contrastCache = new n8.ColorContrastCache(), this._halfContrastCache = new n8.ColorContrastCache(), this._onChangeColors = this.register(new a8.EventEmitter()), this.onChangeColors = this._onChangeColors.event, this._colors = { foreground: l9, background: d7, cursor: _4, cursorAccent: u9, selectionForeground: void 0, selectionBackgroundTransparent: f5, selectionBackgroundOpaque: o5.color.blend(d7, f5), selectionInactiveBackgroundTransparent: f5, selectionInactiveBackgroundOpaque: o5.color.blend(d7, f5), ansi: t6.DEFAULT_ANSI_COLORS.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", () => this._contrastCache.clear())), this.register(this._optionsService.onSpecificOptionChange("theme", () => this._setTheme(this._optionsService.rawOptions.theme)));
          }
          _setTheme(e4 = {}) {
            const i9 = this._colors;
            if (i9.foreground = p5(e4.foreground, l9), i9.background = p5(e4.background, d7), i9.cursor = p5(e4.cursor, _4), i9.cursorAccent = p5(e4.cursorAccent, u9), i9.selectionBackgroundTransparent = p5(e4.selectionBackground, f5), i9.selectionBackgroundOpaque = o5.color.blend(i9.background, i9.selectionBackgroundTransparent), i9.selectionInactiveBackgroundTransparent = p5(e4.selectionInactiveBackground, i9.selectionBackgroundTransparent), i9.selectionInactiveBackgroundOpaque = o5.color.blend(i9.background, i9.selectionInactiveBackgroundTransparent), i9.selectionForeground = e4.selectionForeground ? p5(e4.selectionForeground, o5.NULL_COLOR) : void 0, i9.selectionForeground === o5.NULL_COLOR && (i9.selectionForeground = void 0), o5.color.isOpaque(i9.selectionBackgroundTransparent)) {
              const e5 = 0.3;
              i9.selectionBackgroundTransparent = o5.color.opacity(i9.selectionBackgroundTransparent, e5);
            }
            if (o5.color.isOpaque(i9.selectionInactiveBackgroundTransparent)) {
              const e5 = 0.3;
              i9.selectionInactiveBackgroundTransparent = o5.color.opacity(i9.selectionInactiveBackgroundTransparent, e5);
            }
            if (i9.ansi = t6.DEFAULT_ANSI_COLORS.slice(), i9.ansi[0] = p5(e4.black, t6.DEFAULT_ANSI_COLORS[0]), i9.ansi[1] = p5(e4.red, t6.DEFAULT_ANSI_COLORS[1]), i9.ansi[2] = p5(e4.green, t6.DEFAULT_ANSI_COLORS[2]), i9.ansi[3] = p5(e4.yellow, t6.DEFAULT_ANSI_COLORS[3]), i9.ansi[4] = p5(e4.blue, t6.DEFAULT_ANSI_COLORS[4]), i9.ansi[5] = p5(e4.magenta, t6.DEFAULT_ANSI_COLORS[5]), i9.ansi[6] = p5(e4.cyan, t6.DEFAULT_ANSI_COLORS[6]), i9.ansi[7] = p5(e4.white, t6.DEFAULT_ANSI_COLORS[7]), i9.ansi[8] = p5(e4.brightBlack, t6.DEFAULT_ANSI_COLORS[8]), i9.ansi[9] = p5(e4.brightRed, t6.DEFAULT_ANSI_COLORS[9]), i9.ansi[10] = p5(e4.brightGreen, t6.DEFAULT_ANSI_COLORS[10]), i9.ansi[11] = p5(e4.brightYellow, t6.DEFAULT_ANSI_COLORS[11]), i9.ansi[12] = p5(e4.brightBlue, t6.DEFAULT_ANSI_COLORS[12]), i9.ansi[13] = p5(e4.brightMagenta, t6.DEFAULT_ANSI_COLORS[13]), i9.ansi[14] = p5(e4.brightCyan, t6.DEFAULT_ANSI_COLORS[14]), i9.ansi[15] = p5(e4.brightWhite, t6.DEFAULT_ANSI_COLORS[15]), e4.extendedAnsi) {
              const s12 = Math.min(i9.ansi.length - 16, e4.extendedAnsi.length);
              for (let r5 = 0; r5 < s12; r5++)
                i9.ansi[r5 + 16] = p5(e4.extendedAnsi[r5], t6.DEFAULT_ANSI_COLORS[r5 + 16]);
            }
            this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
          }
          restoreColor(e4) {
            this._restoreColor(e4), this._onChangeColors.fire(this.colors);
          }
          _restoreColor(e4) {
            if (void 0 !== e4)
              switch (e4) {
                case 256:
                  this._colors.foreground = this._restoreColors.foreground;
                  break;
                case 257:
                  this._colors.background = this._restoreColors.background;
                  break;
                case 258:
                  this._colors.cursor = this._restoreColors.cursor;
                  break;
                default:
                  this._colors.ansi[e4] = this._restoreColors.ansi[e4];
              }
            else
              for (let e5 = 0; e5 < this._restoreColors.ansi.length; ++e5)
                this._colors.ansi[e5] = this._restoreColors.ansi[e5];
          }
          modifyColors(e4) {
            e4(this._colors), this._onChangeColors.fire(this.colors);
          }
          _updateRestoreColors() {
            this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
          }
        };
        function p5(e4, t7) {
          if (void 0 !== e4)
            try {
              return o5.css.toColor(e4);
            } catch (e5) {
            }
          return t7;
        }
        t6.ThemeService = v4 = s11([r4(0, c12.IOptionsService)], v4);
      }, 6349: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CircularList = void 0;
        const s11 = i8(8460), r4 = i8(844);
        class n8 extends r4.Disposable {
          constructor(e4) {
            super(), this._maxLength = e4, this.onDeleteEmitter = this.register(new s11.EventEmitter()), this.onDelete = this.onDeleteEmitter.event, this.onInsertEmitter = this.register(new s11.EventEmitter()), this.onInsert = this.onInsertEmitter.event, this.onTrimEmitter = this.register(new s11.EventEmitter()), this.onTrim = this.onTrimEmitter.event, this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
          }
          get maxLength() {
            return this._maxLength;
          }
          set maxLength(e4) {
            if (this._maxLength === e4)
              return;
            const t7 = new Array(e4);
            for (let i9 = 0; i9 < Math.min(e4, this.length); i9++)
              t7[i9] = this._array[this._getCyclicIndex(i9)];
            this._array = t7, this._maxLength = e4, this._startIndex = 0;
          }
          get length() {
            return this._length;
          }
          set length(e4) {
            if (e4 > this._length)
              for (let t7 = this._length; t7 < e4; t7++)
                this._array[t7] = void 0;
            this._length = e4;
          }
          get(e4) {
            return this._array[this._getCyclicIndex(e4)];
          }
          set(e4, t7) {
            this._array[this._getCyclicIndex(e4)] = t7;
          }
          push(e4) {
            this._array[this._getCyclicIndex(this._length)] = e4, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
          }
          recycle() {
            if (this._length !== this._maxLength)
              throw new Error("Can only recycle when the buffer is full");
            return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
          }
          get isFull() {
            return this._length === this._maxLength;
          }
          pop() {
            return this._array[this._getCyclicIndex(this._length-- - 1)];
          }
          splice(e4, t7, ...i9) {
            if (t7) {
              for (let i10 = e4; i10 < this._length - t7; i10++)
                this._array[this._getCyclicIndex(i10)] = this._array[this._getCyclicIndex(i10 + t7)];
              this._length -= t7, this.onDeleteEmitter.fire({ index: e4, amount: t7 });
            }
            for (let t8 = this._length - 1; t8 >= e4; t8--)
              this._array[this._getCyclicIndex(t8 + i9.length)] = this._array[this._getCyclicIndex(t8)];
            for (let t8 = 0; t8 < i9.length; t8++)
              this._array[this._getCyclicIndex(e4 + t8)] = i9[t8];
            if (i9.length && this.onInsertEmitter.fire({ index: e4, amount: i9.length }), this._length + i9.length > this._maxLength) {
              const e5 = this._length + i9.length - this._maxLength;
              this._startIndex += e5, this._length = this._maxLength, this.onTrimEmitter.fire(e5);
            } else
              this._length += i9.length;
          }
          trimStart(e4) {
            e4 > this._length && (e4 = this._length), this._startIndex += e4, this._length -= e4, this.onTrimEmitter.fire(e4);
          }
          shiftElements(e4, t7, i9) {
            if (!(t7 <= 0)) {
              if (e4 < 0 || e4 >= this._length)
                throw new Error("start argument out of range");
              if (e4 + i9 < 0)
                throw new Error("Cannot shift elements in list beyond index 0");
              if (i9 > 0) {
                for (let s13 = t7 - 1; s13 >= 0; s13--)
                  this.set(e4 + s13 + i9, this.get(e4 + s13));
                const s12 = e4 + t7 + i9 - this._length;
                if (s12 > 0)
                  for (this._length += s12; this._length > this._maxLength; )
                    this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
              } else
                for (let s12 = 0; s12 < t7; s12++)
                  this.set(e4 + s12 + i9, this.get(e4 + s12));
            }
          }
          _getCyclicIndex(e4) {
            return (this._startIndex + e4) % this._maxLength;
          }
        }
        t6.CircularList = n8;
      }, 1439: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.clone = void 0, t6.clone = function e4(t7, i8 = 5) {
          if ("object" != typeof t7)
            return t7;
          const s11 = Array.isArray(t7) ? [] : {};
          for (const r4 in t7)
            s11[r4] = i8 <= 1 ? t7[r4] : t7[r4] && e4(t7[r4], i8 - 1);
          return s11;
        };
      }, 8055: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.contrastRatio = t6.toPaddedHex = t6.rgba = t6.rgb = t6.css = t6.color = t6.channels = t6.NULL_COLOR = void 0;
        const s11 = i8(6114);
        let r4 = 0, n8 = 0, o5 = 0, a8 = 0;
        var h3, c12, l9, d7, _4;
        function u9(e4) {
          const t7 = e4.toString(16);
          return t7.length < 2 ? "0" + t7 : t7;
        }
        function f5(e4, t7) {
          return e4 < t7 ? (t7 + 0.05) / (e4 + 0.05) : (e4 + 0.05) / (t7 + 0.05);
        }
        t6.NULL_COLOR = { css: "#00000000", rgba: 0 }, function(e4) {
          e4.toCss = function(e5, t7, i9, s12) {
            return void 0 !== s12 ? `#${u9(e5)}${u9(t7)}${u9(i9)}${u9(s12)}` : `#${u9(e5)}${u9(t7)}${u9(i9)}`;
          }, e4.toRgba = function(e5, t7, i9, s12 = 255) {
            return (e5 << 24 | t7 << 16 | i9 << 8 | s12) >>> 0;
          };
        }(h3 || (t6.channels = h3 = {})), function(e4) {
          function t7(e5, t8) {
            return a8 = Math.round(255 * t8), [r4, n8, o5] = _4.toChannels(e5.rgba), { css: h3.toCss(r4, n8, o5, a8), rgba: h3.toRgba(r4, n8, o5, a8) };
          }
          e4.blend = function(e5, t8) {
            if (a8 = (255 & t8.rgba) / 255, 1 === a8)
              return { css: t8.css, rgba: t8.rgba };
            const i9 = t8.rgba >> 24 & 255, s12 = t8.rgba >> 16 & 255, c13 = t8.rgba >> 8 & 255, l10 = e5.rgba >> 24 & 255, d8 = e5.rgba >> 16 & 255, _5 = e5.rgba >> 8 & 255;
            return r4 = l10 + Math.round((i9 - l10) * a8), n8 = d8 + Math.round((s12 - d8) * a8), o5 = _5 + Math.round((c13 - _5) * a8), { css: h3.toCss(r4, n8, o5), rgba: h3.toRgba(r4, n8, o5) };
          }, e4.isOpaque = function(e5) {
            return 255 == (255 & e5.rgba);
          }, e4.ensureContrastRatio = function(e5, t8, i9) {
            const s12 = _4.ensureContrastRatio(e5.rgba, t8.rgba, i9);
            if (s12)
              return _4.toColor(s12 >> 24 & 255, s12 >> 16 & 255, s12 >> 8 & 255);
          }, e4.opaque = function(e5) {
            const t8 = (255 | e5.rgba) >>> 0;
            return [r4, n8, o5] = _4.toChannels(t8), { css: h3.toCss(r4, n8, o5), rgba: t8 };
          }, e4.opacity = t7, e4.multiplyOpacity = function(e5, i9) {
            return a8 = 255 & e5.rgba, t7(e5, a8 * i9 / 255);
          }, e4.toColorRGB = function(e5) {
            return [e5.rgba >> 24 & 255, e5.rgba >> 16 & 255, e5.rgba >> 8 & 255];
          };
        }(c12 || (t6.color = c12 = {})), function(e4) {
          let t7, i9;
          if (!s11.isNode) {
            const e5 = document.createElement("canvas");
            e5.width = 1, e5.height = 1;
            const s12 = e5.getContext("2d", { willReadFrequently: true });
            s12 && (t7 = s12, t7.globalCompositeOperation = "copy", i9 = t7.createLinearGradient(0, 0, 1, 1));
          }
          e4.toColor = function(e5) {
            if (e5.match(/#[\da-f]{3,8}/i))
              switch (e5.length) {
                case 4:
                  return r4 = parseInt(e5.slice(1, 2).repeat(2), 16), n8 = parseInt(e5.slice(2, 3).repeat(2), 16), o5 = parseInt(e5.slice(3, 4).repeat(2), 16), _4.toColor(r4, n8, o5);
                case 5:
                  return r4 = parseInt(e5.slice(1, 2).repeat(2), 16), n8 = parseInt(e5.slice(2, 3).repeat(2), 16), o5 = parseInt(e5.slice(3, 4).repeat(2), 16), a8 = parseInt(e5.slice(4, 5).repeat(2), 16), _4.toColor(r4, n8, o5, a8);
                case 7:
                  return { css: e5, rgba: (parseInt(e5.slice(1), 16) << 8 | 255) >>> 0 };
                case 9:
                  return { css: e5, rgba: parseInt(e5.slice(1), 16) >>> 0 };
              }
            const s12 = e5.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
            if (s12)
              return r4 = parseInt(s12[1]), n8 = parseInt(s12[2]), o5 = parseInt(s12[3]), a8 = Math.round(255 * (void 0 === s12[5] ? 1 : parseFloat(s12[5]))), _4.toColor(r4, n8, o5, a8);
            if (!t7 || !i9)
              throw new Error("css.toColor: Unsupported css format");
            if (t7.fillStyle = i9, t7.fillStyle = e5, "string" != typeof t7.fillStyle)
              throw new Error("css.toColor: Unsupported css format");
            if (t7.fillRect(0, 0, 1, 1), [r4, n8, o5, a8] = t7.getImageData(0, 0, 1, 1).data, 255 !== a8)
              throw new Error("css.toColor: Unsupported css format");
            return { rgba: h3.toRgba(r4, n8, o5, a8), css: e5 };
          };
        }(l9 || (t6.css = l9 = {})), function(e4) {
          function t7(e5, t8, i9) {
            const s12 = e5 / 255, r5 = t8 / 255, n9 = i9 / 255;
            return 0.2126 * (s12 <= 0.03928 ? s12 / 12.92 : Math.pow((s12 + 0.055) / 1.055, 2.4)) + 0.7152 * (r5 <= 0.03928 ? r5 / 12.92 : Math.pow((r5 + 0.055) / 1.055, 2.4)) + 0.0722 * (n9 <= 0.03928 ? n9 / 12.92 : Math.pow((n9 + 0.055) / 1.055, 2.4));
          }
          e4.relativeLuminance = function(e5) {
            return t7(e5 >> 16 & 255, e5 >> 8 & 255, 255 & e5);
          }, e4.relativeLuminance2 = t7;
        }(d7 || (t6.rgb = d7 = {})), function(e4) {
          function t7(e5, t8, i10) {
            const s12 = e5 >> 24 & 255, r5 = e5 >> 16 & 255, n9 = e5 >> 8 & 255;
            let o6 = t8 >> 24 & 255, a9 = t8 >> 16 & 255, h4 = t8 >> 8 & 255, c13 = f5(d7.relativeLuminance2(o6, a9, h4), d7.relativeLuminance2(s12, r5, n9));
            for (; c13 < i10 && (o6 > 0 || a9 > 0 || h4 > 0); )
              o6 -= Math.max(0, Math.ceil(0.1 * o6)), a9 -= Math.max(0, Math.ceil(0.1 * a9)), h4 -= Math.max(0, Math.ceil(0.1 * h4)), c13 = f5(d7.relativeLuminance2(o6, a9, h4), d7.relativeLuminance2(s12, r5, n9));
            return (o6 << 24 | a9 << 16 | h4 << 8 | 255) >>> 0;
          }
          function i9(e5, t8, i10) {
            const s12 = e5 >> 24 & 255, r5 = e5 >> 16 & 255, n9 = e5 >> 8 & 255;
            let o6 = t8 >> 24 & 255, a9 = t8 >> 16 & 255, h4 = t8 >> 8 & 255, c13 = f5(d7.relativeLuminance2(o6, a9, h4), d7.relativeLuminance2(s12, r5, n9));
            for (; c13 < i10 && (o6 < 255 || a9 < 255 || h4 < 255); )
              o6 = Math.min(255, o6 + Math.ceil(0.1 * (255 - o6))), a9 = Math.min(255, a9 + Math.ceil(0.1 * (255 - a9))), h4 = Math.min(255, h4 + Math.ceil(0.1 * (255 - h4))), c13 = f5(d7.relativeLuminance2(o6, a9, h4), d7.relativeLuminance2(s12, r5, n9));
            return (o6 << 24 | a9 << 16 | h4 << 8 | 255) >>> 0;
          }
          e4.ensureContrastRatio = function(e5, s12, r5) {
            const n9 = d7.relativeLuminance(e5 >> 8), o6 = d7.relativeLuminance(s12 >> 8);
            if (f5(n9, o6) < r5) {
              if (o6 < n9) {
                const o7 = t7(e5, s12, r5), a10 = f5(n9, d7.relativeLuminance(o7 >> 8));
                if (a10 < r5) {
                  const t8 = i9(e5, s12, r5);
                  return a10 > f5(n9, d7.relativeLuminance(t8 >> 8)) ? o7 : t8;
                }
                return o7;
              }
              const a9 = i9(e5, s12, r5), h4 = f5(n9, d7.relativeLuminance(a9 >> 8));
              if (h4 < r5) {
                const i10 = t7(e5, s12, r5);
                return h4 > f5(n9, d7.relativeLuminance(i10 >> 8)) ? a9 : i10;
              }
              return a9;
            }
          }, e4.reduceLuminance = t7, e4.increaseLuminance = i9, e4.toChannels = function(e5) {
            return [e5 >> 24 & 255, e5 >> 16 & 255, e5 >> 8 & 255, 255 & e5];
          }, e4.toColor = function(e5, t8, i10, s12) {
            return { css: h3.toCss(e5, t8, i10, s12), rgba: h3.toRgba(e5, t8, i10, s12) };
          };
        }(_4 || (t6.rgba = _4 = {})), t6.toPaddedHex = u9, t6.contrastRatio = f5;
      }, 8969: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CoreTerminal = void 0;
        const s11 = i8(844), r4 = i8(2585), n8 = i8(4348), o5 = i8(7866), a8 = i8(744), h3 = i8(7302), c12 = i8(6975), l9 = i8(8460), d7 = i8(1753), _4 = i8(1480), u9 = i8(7994), f5 = i8(9282), v4 = i8(5435), p5 = i8(5981), g6 = i8(2660);
        let m8 = false;
        class S2 extends s11.Disposable {
          get onScroll() {
            return this._onScrollApi || (this._onScrollApi = this.register(new l9.EventEmitter()), this._onScroll.event((e4) => {
              var t7;
              null === (t7 = this._onScrollApi) || void 0 === t7 || t7.fire(e4.position);
            })), this._onScrollApi.event;
          }
          get cols() {
            return this._bufferService.cols;
          }
          get rows() {
            return this._bufferService.rows;
          }
          get buffers() {
            return this._bufferService.buffers;
          }
          get options() {
            return this.optionsService.options;
          }
          set options(e4) {
            for (const t7 in e4)
              this.optionsService.options[t7] = e4[t7];
          }
          constructor(e4) {
            super(), this._windowsWrappingHeuristics = this.register(new s11.MutableDisposable()), this._onBinary = this.register(new l9.EventEmitter()), this.onBinary = this._onBinary.event, this._onData = this.register(new l9.EventEmitter()), this.onData = this._onData.event, this._onLineFeed = this.register(new l9.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onResize = this.register(new l9.EventEmitter()), this.onResize = this._onResize.event, this._onWriteParsed = this.register(new l9.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event, this._onScroll = this.register(new l9.EventEmitter()), this._instantiationService = new n8.InstantiationService(), this.optionsService = this.register(new h3.OptionsService(e4)), this._instantiationService.setService(r4.IOptionsService, this.optionsService), this._bufferService = this.register(this._instantiationService.createInstance(a8.BufferService)), this._instantiationService.setService(r4.IBufferService, this._bufferService), this._logService = this.register(this._instantiationService.createInstance(o5.LogService)), this._instantiationService.setService(r4.ILogService, this._logService), this.coreService = this.register(this._instantiationService.createInstance(c12.CoreService)), this._instantiationService.setService(r4.ICoreService, this.coreService), this.coreMouseService = this.register(this._instantiationService.createInstance(d7.CoreMouseService)), this._instantiationService.setService(r4.ICoreMouseService, this.coreMouseService), this.unicodeService = this.register(this._instantiationService.createInstance(_4.UnicodeService)), this._instantiationService.setService(r4.IUnicodeService, this.unicodeService), this._charsetService = this._instantiationService.createInstance(u9.CharsetService), this._instantiationService.setService(r4.ICharsetService, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(g6.OscLinkService), this._instantiationService.setService(r4.IOscLinkService, this._oscLinkService), this._inputHandler = this.register(new v4.InputHandler(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this.register((0, l9.forwardEvent)(this._inputHandler.onLineFeed, this._onLineFeed)), this.register(this._inputHandler), this.register((0, l9.forwardEvent)(this._bufferService.onResize, this._onResize)), this.register((0, l9.forwardEvent)(this.coreService.onData, this._onData)), this.register((0, l9.forwardEvent)(this.coreService.onBinary, this._onBinary)), this.register(this.coreService.onRequestScrollToBottom(() => this.scrollToBottom())), this.register(this.coreService.onUserInput(() => this._writeBuffer.handleUserInput())), this.register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], () => this._handleWindowsPtyOptionChange())), this.register(this._bufferService.onScroll((e5) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            })), this.register(this._inputHandler.onScroll((e5) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            })), this._writeBuffer = this.register(new p5.WriteBuffer((e5, t7) => this._inputHandler.parse(e5, t7))), this.register((0, l9.forwardEvent)(this._writeBuffer.onWriteParsed, this._onWriteParsed));
          }
          write(e4, t7) {
            this._writeBuffer.write(e4, t7);
          }
          writeSync(e4, t7) {
            this._logService.logLevel <= r4.LogLevelEnum.WARN && !m8 && (this._logService.warn("writeSync is unreliable and will be removed soon."), m8 = true), this._writeBuffer.writeSync(e4, t7);
          }
          resize(e4, t7) {
            isNaN(e4) || isNaN(t7) || (e4 = Math.max(e4, a8.MINIMUM_COLS), t7 = Math.max(t7, a8.MINIMUM_ROWS), this._bufferService.resize(e4, t7));
          }
          scroll(e4, t7 = false) {
            this._bufferService.scroll(e4, t7);
          }
          scrollLines(e4, t7, i9) {
            this._bufferService.scrollLines(e4, t7, i9);
          }
          scrollPages(e4) {
            this.scrollLines(e4 * (this.rows - 1));
          }
          scrollToTop() {
            this.scrollLines(-this._bufferService.buffer.ydisp);
          }
          scrollToBottom() {
            this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
          }
          scrollToLine(e4) {
            const t7 = e4 - this._bufferService.buffer.ydisp;
            0 !== t7 && this.scrollLines(t7);
          }
          registerEscHandler(e4, t7) {
            return this._inputHandler.registerEscHandler(e4, t7);
          }
          registerDcsHandler(e4, t7) {
            return this._inputHandler.registerDcsHandler(e4, t7);
          }
          registerCsiHandler(e4, t7) {
            return this._inputHandler.registerCsiHandler(e4, t7);
          }
          registerOscHandler(e4, t7) {
            return this._inputHandler.registerOscHandler(e4, t7);
          }
          _setup() {
            this._handleWindowsPtyOptionChange();
          }
          reset() {
            this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
          }
          _handleWindowsPtyOptionChange() {
            let e4 = false;
            const t7 = this.optionsService.rawOptions.windowsPty;
            t7 && void 0 !== t7.buildNumber && void 0 !== t7.buildNumber ? e4 = !!("conpty" === t7.backend && t7.buildNumber < 21376) : this.optionsService.rawOptions.windowsMode && (e4 = true), e4 ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
          }
          _enableWindowsWrappingHeuristics() {
            if (!this._windowsWrappingHeuristics.value) {
              const e4 = [];
              e4.push(this.onLineFeed(f5.updateWindowsModeWrappedState.bind(null, this._bufferService))), e4.push(this.registerCsiHandler({ final: "H" }, () => ((0, f5.updateWindowsModeWrappedState)(this._bufferService), false))), this._windowsWrappingHeuristics.value = (0, s11.toDisposable)(() => {
                for (const t7 of e4)
                  t7.dispose();
              });
            }
          }
        }
        t6.CoreTerminal = S2;
      }, 8460: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.forwardEvent = t6.EventEmitter = void 0, t6.EventEmitter = class {
          constructor() {
            this._listeners = [], this._disposed = false;
          }
          get event() {
            return this._event || (this._event = (e4) => (this._listeners.push(e4), { dispose: () => {
              if (!this._disposed) {
                for (let t7 = 0; t7 < this._listeners.length; t7++)
                  if (this._listeners[t7] === e4)
                    return void this._listeners.splice(t7, 1);
              }
            } })), this._event;
          }
          fire(e4, t7) {
            const i8 = [];
            for (let e5 = 0; e5 < this._listeners.length; e5++)
              i8.push(this._listeners[e5]);
            for (let s11 = 0; s11 < i8.length; s11++)
              i8[s11].call(void 0, e4, t7);
          }
          dispose() {
            this.clearListeners(), this._disposed = true;
          }
          clearListeners() {
            this._listeners && (this._listeners.length = 0);
          }
        }, t6.forwardEvent = function(e4, t7) {
          return e4((e5) => t7.fire(e5));
        };
      }, 5435: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.InputHandler = t6.WindowsOptionsReportType = void 0;
        const n8 = i8(2584), o5 = i8(7116), a8 = i8(2015), h3 = i8(844), c12 = i8(482), l9 = i8(8437), d7 = i8(8460), _4 = i8(643), u9 = i8(511), f5 = i8(3734), v4 = i8(2585), p5 = i8(6242), g6 = i8(6351), m8 = i8(5941), S2 = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 }, C3 = 131072;
        function b4(e4, t7) {
          if (e4 > 24)
            return t7.setWinLines || false;
          switch (e4) {
            case 1:
              return !!t7.restoreWin;
            case 2:
              return !!t7.minimizeWin;
            case 3:
              return !!t7.setWinPosition;
            case 4:
              return !!t7.setWinSizePixels;
            case 5:
              return !!t7.raiseWin;
            case 6:
              return !!t7.lowerWin;
            case 7:
              return !!t7.refreshWin;
            case 8:
              return !!t7.setWinSizeChars;
            case 9:
              return !!t7.maximizeWin;
            case 10:
              return !!t7.fullscreenWin;
            case 11:
              return !!t7.getWinState;
            case 13:
              return !!t7.getWinPosition;
            case 14:
              return !!t7.getWinSizePixels;
            case 15:
              return !!t7.getScreenSizePixels;
            case 16:
              return !!t7.getCellSizePixels;
            case 18:
              return !!t7.getWinSizeChars;
            case 19:
              return !!t7.getScreenSizeChars;
            case 20:
              return !!t7.getIconTitle;
            case 21:
              return !!t7.getWinTitle;
            case 22:
              return !!t7.pushTitle;
            case 23:
              return !!t7.popTitle;
            case 24:
              return !!t7.setWinLines;
          }
          return false;
        }
        var y4;
        !function(e4) {
          e4[e4.GET_WIN_SIZE_PIXELS = 0] = "GET_WIN_SIZE_PIXELS", e4[e4.GET_CELL_SIZE_PIXELS = 1] = "GET_CELL_SIZE_PIXELS";
        }(y4 || (t6.WindowsOptionsReportType = y4 = {}));
        let w3 = 0;
        class E4 extends h3.Disposable {
          getAttrData() {
            return this._curAttrData;
          }
          constructor(e4, t7, i9, s12, r5, h4, _5, f6, v5 = new a8.EscapeSequenceParser()) {
            super(), this._bufferService = e4, this._charsetService = t7, this._coreService = i9, this._logService = s12, this._optionsService = r5, this._oscLinkService = h4, this._coreMouseService = _5, this._unicodeService = f6, this._parser = v5, this._parseBuffer = new Uint32Array(4096), this._stringDecoder = new c12.StringToUtf32(), this._utf8Decoder = new c12.Utf8ToUtf32(), this._workCell = new u9.CellData(), this._windowTitle = "", this._iconName = "", this._windowTitleStack = [], this._iconNameStack = [], this._curAttrData = l9.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l9.DEFAULT_ATTR_DATA.clone(), this._onRequestBell = this.register(new d7.EventEmitter()), this.onRequestBell = this._onRequestBell.event, this._onRequestRefreshRows = this.register(new d7.EventEmitter()), this.onRequestRefreshRows = this._onRequestRefreshRows.event, this._onRequestReset = this.register(new d7.EventEmitter()), this.onRequestReset = this._onRequestReset.event, this._onRequestSendFocus = this.register(new d7.EventEmitter()), this.onRequestSendFocus = this._onRequestSendFocus.event, this._onRequestSyncScrollBar = this.register(new d7.EventEmitter()), this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event, this._onRequestWindowsOptionsReport = this.register(new d7.EventEmitter()), this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event, this._onA11yChar = this.register(new d7.EventEmitter()), this.onA11yChar = this._onA11yChar.event, this._onA11yTab = this.register(new d7.EventEmitter()), this.onA11yTab = this._onA11yTab.event, this._onCursorMove = this.register(new d7.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onLineFeed = this.register(new d7.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onScroll = this.register(new d7.EventEmitter()), this.onScroll = this._onScroll.event, this._onTitleChange = this.register(new d7.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onColor = this.register(new d7.EventEmitter()), this.onColor = this._onColor.event, this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 }, this._specialColors = [256, 257, 258], this.register(this._parser), this._dirtyRowTracker = new k2(this._bufferService), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate((e5) => this._activeBuffer = e5.activeBuffer)), this._parser.setCsiHandlerFallback((e5, t8) => {
              this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(e5), params: t8.toArray() });
            }), this._parser.setEscHandlerFallback((e5) => {
              this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(e5) });
            }), this._parser.setExecuteHandlerFallback((e5) => {
              this._logService.debug("Unknown EXECUTE code: ", { code: e5 });
            }), this._parser.setOscHandlerFallback((e5, t8, i10) => {
              this._logService.debug("Unknown OSC code: ", { identifier: e5, action: t8, data: i10 });
            }), this._parser.setDcsHandlerFallback((e5, t8, i10) => {
              "HOOK" === t8 && (i10 = i10.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(e5), action: t8, payload: i10 });
            }), this._parser.setPrintHandler((e5, t8, i10) => this.print(e5, t8, i10)), this._parser.registerCsiHandler({ final: "@" }, (e5) => this.insertChars(e5)), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, (e5) => this.scrollLeft(e5)), this._parser.registerCsiHandler({ final: "A" }, (e5) => this.cursorUp(e5)), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, (e5) => this.scrollRight(e5)), this._parser.registerCsiHandler({ final: "B" }, (e5) => this.cursorDown(e5)), this._parser.registerCsiHandler({ final: "C" }, (e5) => this.cursorForward(e5)), this._parser.registerCsiHandler({ final: "D" }, (e5) => this.cursorBackward(e5)), this._parser.registerCsiHandler({ final: "E" }, (e5) => this.cursorNextLine(e5)), this._parser.registerCsiHandler({ final: "F" }, (e5) => this.cursorPrecedingLine(e5)), this._parser.registerCsiHandler({ final: "G" }, (e5) => this.cursorCharAbsolute(e5)), this._parser.registerCsiHandler({ final: "H" }, (e5) => this.cursorPosition(e5)), this._parser.registerCsiHandler({ final: "I" }, (e5) => this.cursorForwardTab(e5)), this._parser.registerCsiHandler({ final: "J" }, (e5) => this.eraseInDisplay(e5, false)), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, (e5) => this.eraseInDisplay(e5, true)), this._parser.registerCsiHandler({ final: "K" }, (e5) => this.eraseInLine(e5, false)), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, (e5) => this.eraseInLine(e5, true)), this._parser.registerCsiHandler({ final: "L" }, (e5) => this.insertLines(e5)), this._parser.registerCsiHandler({ final: "M" }, (e5) => this.deleteLines(e5)), this._parser.registerCsiHandler({ final: "P" }, (e5) => this.deleteChars(e5)), this._parser.registerCsiHandler({ final: "S" }, (e5) => this.scrollUp(e5)), this._parser.registerCsiHandler({ final: "T" }, (e5) => this.scrollDown(e5)), this._parser.registerCsiHandler({ final: "X" }, (e5) => this.eraseChars(e5)), this._parser.registerCsiHandler({ final: "Z" }, (e5) => this.cursorBackwardTab(e5)), this._parser.registerCsiHandler({ final: "`" }, (e5) => this.charPosAbsolute(e5)), this._parser.registerCsiHandler({ final: "a" }, (e5) => this.hPositionRelative(e5)), this._parser.registerCsiHandler({ final: "b" }, (e5) => this.repeatPrecedingCharacter(e5)), this._parser.registerCsiHandler({ final: "c" }, (e5) => this.sendDeviceAttributesPrimary(e5)), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, (e5) => this.sendDeviceAttributesSecondary(e5)), this._parser.registerCsiHandler({ final: "d" }, (e5) => this.linePosAbsolute(e5)), this._parser.registerCsiHandler({ final: "e" }, (e5) => this.vPositionRelative(e5)), this._parser.registerCsiHandler({ final: "f" }, (e5) => this.hVPosition(e5)), this._parser.registerCsiHandler({ final: "g" }, (e5) => this.tabClear(e5)), this._parser.registerCsiHandler({ final: "h" }, (e5) => this.setMode(e5)), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, (e5) => this.setModePrivate(e5)), this._parser.registerCsiHandler({ final: "l" }, (e5) => this.resetMode(e5)), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, (e5) => this.resetModePrivate(e5)), this._parser.registerCsiHandler({ final: "m" }, (e5) => this.charAttributes(e5)), this._parser.registerCsiHandler({ final: "n" }, (e5) => this.deviceStatus(e5)), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, (e5) => this.deviceStatusPrivate(e5)), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, (e5) => this.softReset(e5)), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, (e5) => this.setCursorStyle(e5)), this._parser.registerCsiHandler({ final: "r" }, (e5) => this.setScrollRegion(e5)), this._parser.registerCsiHandler({ final: "s" }, (e5) => this.saveCursor(e5)), this._parser.registerCsiHandler({ final: "t" }, (e5) => this.windowOptions(e5)), this._parser.registerCsiHandler({ final: "u" }, (e5) => this.restoreCursor(e5)), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, (e5) => this.insertColumns(e5)), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, (e5) => this.deleteColumns(e5)), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, (e5) => this.selectProtected(e5)), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, (e5) => this.requestMode(e5, true)), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (e5) => this.requestMode(e5, false)), this._parser.setExecuteHandler(n8.C0.BEL, () => this.bell()), this._parser.setExecuteHandler(n8.C0.LF, () => this.lineFeed()), this._parser.setExecuteHandler(n8.C0.VT, () => this.lineFeed()), this._parser.setExecuteHandler(n8.C0.FF, () => this.lineFeed()), this._parser.setExecuteHandler(n8.C0.CR, () => this.carriageReturn()), this._parser.setExecuteHandler(n8.C0.BS, () => this.backspace()), this._parser.setExecuteHandler(n8.C0.HT, () => this.tab()), this._parser.setExecuteHandler(n8.C0.SO, () => this.shiftOut()), this._parser.setExecuteHandler(n8.C0.SI, () => this.shiftIn()), this._parser.setExecuteHandler(n8.C1.IND, () => this.index()), this._parser.setExecuteHandler(n8.C1.NEL, () => this.nextLine()), this._parser.setExecuteHandler(n8.C1.HTS, () => this.tabSet()), this._parser.registerOscHandler(0, new p5.OscHandler((e5) => (this.setTitle(e5), this.setIconName(e5), true))), this._parser.registerOscHandler(1, new p5.OscHandler((e5) => this.setIconName(e5))), this._parser.registerOscHandler(2, new p5.OscHandler((e5) => this.setTitle(e5))), this._parser.registerOscHandler(4, new p5.OscHandler((e5) => this.setOrReportIndexedColor(e5))), this._parser.registerOscHandler(8, new p5.OscHandler((e5) => this.setHyperlink(e5))), this._parser.registerOscHandler(10, new p5.OscHandler((e5) => this.setOrReportFgColor(e5))), this._parser.registerOscHandler(11, new p5.OscHandler((e5) => this.setOrReportBgColor(e5))), this._parser.registerOscHandler(12, new p5.OscHandler((e5) => this.setOrReportCursorColor(e5))), this._parser.registerOscHandler(104, new p5.OscHandler((e5) => this.restoreIndexedColor(e5))), this._parser.registerOscHandler(110, new p5.OscHandler((e5) => this.restoreFgColor(e5))), this._parser.registerOscHandler(111, new p5.OscHandler((e5) => this.restoreBgColor(e5))), this._parser.registerOscHandler(112, new p5.OscHandler((e5) => this.restoreCursorColor(e5))), this._parser.registerEscHandler({ final: "7" }, () => this.saveCursor()), this._parser.registerEscHandler({ final: "8" }, () => this.restoreCursor()), this._parser.registerEscHandler({ final: "D" }, () => this.index()), this._parser.registerEscHandler({ final: "E" }, () => this.nextLine()), this._parser.registerEscHandler({ final: "H" }, () => this.tabSet()), this._parser.registerEscHandler({ final: "M" }, () => this.reverseIndex()), this._parser.registerEscHandler({ final: "=" }, () => this.keypadApplicationMode()), this._parser.registerEscHandler({ final: ">" }, () => this.keypadNumericMode()), this._parser.registerEscHandler({ final: "c" }, () => this.fullReset()), this._parser.registerEscHandler({ final: "n" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "o" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "|" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "}" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "~" }, () => this.setgLevel(1)), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, () => this.selectDefaultCharset()), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, () => this.selectDefaultCharset());
            for (const e5 in o5.CHARSETS)
              this._parser.registerEscHandler({ intermediates: "(", final: e5 }, () => this.selectCharset("(" + e5)), this._parser.registerEscHandler({ intermediates: ")", final: e5 }, () => this.selectCharset(")" + e5)), this._parser.registerEscHandler({ intermediates: "*", final: e5 }, () => this.selectCharset("*" + e5)), this._parser.registerEscHandler({ intermediates: "+", final: e5 }, () => this.selectCharset("+" + e5)), this._parser.registerEscHandler({ intermediates: "-", final: e5 }, () => this.selectCharset("-" + e5)), this._parser.registerEscHandler({ intermediates: ".", final: e5 }, () => this.selectCharset("." + e5)), this._parser.registerEscHandler({ intermediates: "/", final: e5 }, () => this.selectCharset("/" + e5));
            this._parser.registerEscHandler({ intermediates: "#", final: "8" }, () => this.screenAlignmentPattern()), this._parser.setErrorHandler((e5) => (this._logService.error("Parsing error: ", e5), e5)), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new g6.DcsHandler((e5, t8) => this.requestStatusString(e5, t8)));
          }
          _preserveStack(e4, t7, i9, s12) {
            this._parseStack.paused = true, this._parseStack.cursorStartX = e4, this._parseStack.cursorStartY = t7, this._parseStack.decodedLength = i9, this._parseStack.position = s12;
          }
          _logSlowResolvingAsync(e4) {
            this._logService.logLevel <= v4.LogLevelEnum.WARN && Promise.race([e4, new Promise((e5, t7) => setTimeout(() => t7("#SLOW_TIMEOUT"), 5e3))]).catch((e5) => {
              if ("#SLOW_TIMEOUT" !== e5)
                throw e5;
              console.warn("async parser handler taking longer than 5000 ms");
            });
          }
          _getCurrentLinkId() {
            return this._curAttrData.extended.urlId;
          }
          parse(e4, t7) {
            let i9, s12 = this._activeBuffer.x, r5 = this._activeBuffer.y, n9 = 0;
            const o6 = this._parseStack.paused;
            if (o6) {
              if (i9 = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, t7))
                return this._logSlowResolvingAsync(i9), i9;
              s12 = this._parseStack.cursorStartX, r5 = this._parseStack.cursorStartY, this._parseStack.paused = false, e4.length > C3 && (n9 = this._parseStack.position + C3);
            }
            if (this._logService.logLevel <= v4.LogLevelEnum.DEBUG && this._logService.debug("parsing data" + ("string" == typeof e4 ? ` "${e4}"` : ` "${Array.prototype.map.call(e4, (e5) => String.fromCharCode(e5)).join("")}"`), "string" == typeof e4 ? e4.split("").map((e5) => e5.charCodeAt(0)) : e4), this._parseBuffer.length < e4.length && this._parseBuffer.length < C3 && (this._parseBuffer = new Uint32Array(Math.min(e4.length, C3))), o6 || this._dirtyRowTracker.clearRange(), e4.length > C3)
              for (let t8 = n9; t8 < e4.length; t8 += C3) {
                const n10 = t8 + C3 < e4.length ? t8 + C3 : e4.length, o7 = "string" == typeof e4 ? this._stringDecoder.decode(e4.substring(t8, n10), this._parseBuffer) : this._utf8Decoder.decode(e4.subarray(t8, n10), this._parseBuffer);
                if (i9 = this._parser.parse(this._parseBuffer, o7))
                  return this._preserveStack(s12, r5, o7, t8), this._logSlowResolvingAsync(i9), i9;
              }
            else if (!o6) {
              const t8 = "string" == typeof e4 ? this._stringDecoder.decode(e4, this._parseBuffer) : this._utf8Decoder.decode(e4, this._parseBuffer);
              if (i9 = this._parser.parse(this._parseBuffer, t8))
                return this._preserveStack(s12, r5, t8, 0), this._logSlowResolvingAsync(i9), i9;
            }
            this._activeBuffer.x === s12 && this._activeBuffer.y === r5 || this._onCursorMove.fire(), this._onRequestRefreshRows.fire(this._dirtyRowTracker.start, this._dirtyRowTracker.end);
          }
          print(e4, t7, i9) {
            let s12, r5;
            const n9 = this._charsetService.charset, o6 = this._optionsService.rawOptions.screenReaderMode, a9 = this._bufferService.cols, h4 = this._coreService.decPrivateModes.wraparound, l10 = this._coreService.modes.insertMode, d8 = this._curAttrData;
            let u10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && i9 - t7 > 0 && 2 === u10.getWidth(this._activeBuffer.x - 1) && u10.setCellFromCodePoint(this._activeBuffer.x - 1, 0, 1, d8.fg, d8.bg, d8.extended);
            for (let f6 = t7; f6 < i9; ++f6) {
              if (s12 = e4[f6], r5 = this._unicodeService.wcwidth(s12), s12 < 127 && n9) {
                const e5 = n9[String.fromCharCode(s12)];
                e5 && (s12 = e5.charCodeAt(0));
              }
              if (o6 && this._onA11yChar.fire((0, c12.stringFromCodePoint)(s12)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), r5 || !this._activeBuffer.x) {
                if (this._activeBuffer.x + r5 - 1 >= a9) {
                  if (h4) {
                    for (; this._activeBuffer.x < a9; )
                      u10.setCellFromCodePoint(this._activeBuffer.x++, 0, 1, d8.fg, d8.bg, d8.extended);
                    this._activeBuffer.x = 0, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), u10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
                  } else if (this._activeBuffer.x = a9 - 1, 2 === r5)
                    continue;
                }
                if (l10 && (u10.insertCells(this._activeBuffer.x, r5, this._activeBuffer.getNullCell(d8), d8), 2 === u10.getWidth(a9 - 1) && u10.setCellFromCodePoint(a9 - 1, _4.NULL_CELL_CODE, _4.NULL_CELL_WIDTH, d8.fg, d8.bg, d8.extended)), u10.setCellFromCodePoint(this._activeBuffer.x++, s12, r5, d8.fg, d8.bg, d8.extended), r5 > 0)
                  for (; --r5; )
                    u10.setCellFromCodePoint(this._activeBuffer.x++, 0, 0, d8.fg, d8.bg, d8.extended);
              } else
                u10.getWidth(this._activeBuffer.x - 1) ? u10.addCodepointToCell(this._activeBuffer.x - 1, s12) : u10.addCodepointToCell(this._activeBuffer.x - 2, s12);
            }
            i9 - t7 > 0 && (u10.loadCell(this._activeBuffer.x - 1, this._workCell), 2 === this._workCell.getWidth() || this._workCell.getCode() > 65535 ? this._parser.precedingCodepoint = 0 : this._workCell.isCombined() ? this._parser.precedingCodepoint = this._workCell.getChars().charCodeAt(0) : this._parser.precedingCodepoint = this._workCell.content), this._activeBuffer.x < a9 && i9 - t7 > 0 && 0 === u10.getWidth(this._activeBuffer.x) && !u10.hasContent(this._activeBuffer.x) && u10.setCellFromCodePoint(this._activeBuffer.x, 0, 1, d8.fg, d8.bg, d8.extended), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          registerCsiHandler(e4, t7) {
            return "t" !== e4.final || e4.prefix || e4.intermediates ? this._parser.registerCsiHandler(e4, t7) : this._parser.registerCsiHandler(e4, (e5) => !b4(e5.params[0], this._optionsService.rawOptions.windowOptions) || t7(e5));
          }
          registerDcsHandler(e4, t7) {
            return this._parser.registerDcsHandler(e4, new g6.DcsHandler(t7));
          }
          registerEscHandler(e4, t7) {
            return this._parser.registerEscHandler(e4, t7);
          }
          registerOscHandler(e4, t7) {
            return this._parser.registerOscHandler(e4, new p5.OscHandler(t7));
          }
          bell() {
            return this._onRequestBell.fire(), true;
          }
          lineFeed() {
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
          }
          carriageReturn() {
            return this._activeBuffer.x = 0, true;
          }
          backspace() {
            var e4;
            if (!this._coreService.decPrivateModes.reverseWraparound)
              return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
            if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0)
              this._activeBuffer.x--;
            else if (0 === this._activeBuffer.x && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && (null === (e4 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)) || void 0 === e4 ? void 0 : e4.isWrapped)) {
              this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
              const e5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
              e5.hasWidth(this._activeBuffer.x) && !e5.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
            }
            return this._restrictCursor(), true;
          }
          tab() {
            if (this._activeBuffer.x >= this._bufferService.cols)
              return true;
            const e4 = this._activeBuffer.x;
            return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e4), true;
          }
          shiftOut() {
            return this._charsetService.setgLevel(1), true;
          }
          shiftIn() {
            return this._charsetService.setgLevel(0), true;
          }
          _restrictCursor(e4 = this._bufferService.cols - 1) {
            this._activeBuffer.x = Math.min(e4, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _setCursor(e4, t7) {
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e4, this._activeBuffer.y = this._activeBuffer.scrollTop + t7) : (this._activeBuffer.x = e4, this._activeBuffer.y = t7), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _moveCursor(e4, t7) {
            this._restrictCursor(), this._setCursor(this._activeBuffer.x + e4, this._activeBuffer.y + t7);
          }
          cursorUp(e4) {
            const t7 = this._activeBuffer.y - this._activeBuffer.scrollTop;
            return t7 >= 0 ? this._moveCursor(0, -Math.min(t7, e4.params[0] || 1)) : this._moveCursor(0, -(e4.params[0] || 1)), true;
          }
          cursorDown(e4) {
            const t7 = this._activeBuffer.scrollBottom - this._activeBuffer.y;
            return t7 >= 0 ? this._moveCursor(0, Math.min(t7, e4.params[0] || 1)) : this._moveCursor(0, e4.params[0] || 1), true;
          }
          cursorForward(e4) {
            return this._moveCursor(e4.params[0] || 1, 0), true;
          }
          cursorBackward(e4) {
            return this._moveCursor(-(e4.params[0] || 1), 0), true;
          }
          cursorNextLine(e4) {
            return this.cursorDown(e4), this._activeBuffer.x = 0, true;
          }
          cursorPrecedingLine(e4) {
            return this.cursorUp(e4), this._activeBuffer.x = 0, true;
          }
          cursorCharAbsolute(e4) {
            return this._setCursor((e4.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          cursorPosition(e4) {
            return this._setCursor(e4.length >= 2 ? (e4.params[1] || 1) - 1 : 0, (e4.params[0] || 1) - 1), true;
          }
          charPosAbsolute(e4) {
            return this._setCursor((e4.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          hPositionRelative(e4) {
            return this._moveCursor(e4.params[0] || 1, 0), true;
          }
          linePosAbsolute(e4) {
            return this._setCursor(this._activeBuffer.x, (e4.params[0] || 1) - 1), true;
          }
          vPositionRelative(e4) {
            return this._moveCursor(0, e4.params[0] || 1), true;
          }
          hVPosition(e4) {
            return this.cursorPosition(e4), true;
          }
          tabClear(e4) {
            const t7 = e4.params[0];
            return 0 === t7 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : 3 === t7 && (this._activeBuffer.tabs = {}), true;
          }
          cursorForwardTab(e4) {
            if (this._activeBuffer.x >= this._bufferService.cols)
              return true;
            let t7 = e4.params[0] || 1;
            for (; t7--; )
              this._activeBuffer.x = this._activeBuffer.nextStop();
            return true;
          }
          cursorBackwardTab(e4) {
            if (this._activeBuffer.x >= this._bufferService.cols)
              return true;
            let t7 = e4.params[0] || 1;
            for (; t7--; )
              this._activeBuffer.x = this._activeBuffer.prevStop();
            return true;
          }
          selectProtected(e4) {
            const t7 = e4.params[0];
            return 1 === t7 && (this._curAttrData.bg |= 536870912), 2 !== t7 && 0 !== t7 || (this._curAttrData.bg &= -536870913), true;
          }
          _eraseInBufferLine(e4, t7, i9, s12 = false, r5 = false) {
            const n9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e4);
            n9.replaceCells(t7, i9, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData(), r5), s12 && (n9.isWrapped = false);
          }
          _resetBufferLine(e4, t7 = false) {
            const i9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e4);
            i9 && (i9.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), t7), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e4), i9.isWrapped = false);
          }
          eraseInDisplay(e4, t7 = false) {
            let i9;
            switch (this._restrictCursor(this._bufferService.cols), e4.params[0]) {
              case 0:
                for (i9 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i9), this._eraseInBufferLine(i9++, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t7); i9 < this._bufferService.rows; i9++)
                  this._resetBufferLine(i9, t7);
                this._dirtyRowTracker.markDirty(i9);
                break;
              case 1:
                for (i9 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i9), this._eraseInBufferLine(i9, 0, this._activeBuffer.x + 1, true, t7), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(i9 + 1).isWrapped = false); i9--; )
                  this._resetBufferLine(i9, t7);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 2:
                for (i9 = this._bufferService.rows, this._dirtyRowTracker.markDirty(i9 - 1); i9--; )
                  this._resetBufferLine(i9, t7);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 3:
                const e5 = this._activeBuffer.lines.length - this._bufferService.rows;
                e5 > 0 && (this._activeBuffer.lines.trimStart(e5), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - e5, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - e5, 0), this._onScroll.fire(0));
            }
            return true;
          }
          eraseInLine(e4, t7 = false) {
            switch (this._restrictCursor(this._bufferService.cols), e4.params[0]) {
              case 0:
                this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t7);
                break;
              case 1:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, t7);
                break;
              case 2:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, t7);
            }
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
          }
          insertLines(e4) {
            this._restrictCursor();
            let t7 = e4.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const i9 = this._activeBuffer.ybase + this._activeBuffer.y, s12 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, r5 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s12 + 1;
            for (; t7--; )
              this._activeBuffer.lines.splice(r5 - 1, 1), this._activeBuffer.lines.splice(i9, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          deleteLines(e4) {
            this._restrictCursor();
            let t7 = e4.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const i9 = this._activeBuffer.ybase + this._activeBuffer.y;
            let s12;
            for (s12 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, s12 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s12; t7--; )
              this._activeBuffer.lines.splice(i9, 1), this._activeBuffer.lines.splice(s12, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          insertChars(e4) {
            this._restrictCursor();
            const t7 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t7 && (t7.insertCells(this._activeBuffer.x, e4.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          deleteChars(e4) {
            this._restrictCursor();
            const t7 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t7 && (t7.deleteCells(this._activeBuffer.x, e4.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          scrollUp(e4) {
            let t7 = e4.params[0] || 1;
            for (; t7--; )
              this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollDown(e4) {
            let t7 = e4.params[0] || 1;
            for (; t7--; )
              this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(l9.DEFAULT_ATTR_DATA));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollLeft(e4) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const t7 = e4.params[0] || 1;
            for (let e5 = this._activeBuffer.scrollTop; e5 <= this._activeBuffer.scrollBottom; ++e5) {
              const i9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
              i9.deleteCells(0, t7, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i9.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollRight(e4) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const t7 = e4.params[0] || 1;
            for (let e5 = this._activeBuffer.scrollTop; e5 <= this._activeBuffer.scrollBottom; ++e5) {
              const i9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
              i9.insertCells(0, t7, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i9.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          insertColumns(e4) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const t7 = e4.params[0] || 1;
            for (let e5 = this._activeBuffer.scrollTop; e5 <= this._activeBuffer.scrollBottom; ++e5) {
              const i9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
              i9.insertCells(this._activeBuffer.x, t7, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i9.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          deleteColumns(e4) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop)
              return true;
            const t7 = e4.params[0] || 1;
            for (let e5 = this._activeBuffer.scrollTop; e5 <= this._activeBuffer.scrollBottom; ++e5) {
              const i9 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
              i9.deleteCells(this._activeBuffer.x, t7, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i9.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          eraseChars(e4) {
            this._restrictCursor();
            const t7 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t7 && (t7.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e4.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          repeatPrecedingCharacter(e4) {
            if (!this._parser.precedingCodepoint)
              return true;
            const t7 = e4.params[0] || 1, i9 = new Uint32Array(t7);
            for (let e5 = 0; e5 < t7; ++e5)
              i9[e5] = this._parser.precedingCodepoint;
            return this.print(i9, 0, i9.length), true;
          }
          sendDeviceAttributesPrimary(e4) {
            return e4.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(n8.C0.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(n8.C0.ESC + "[?6c")), true;
          }
          sendDeviceAttributesSecondary(e4) {
            return e4.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(n8.C0.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(n8.C0.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e4.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(n8.C0.ESC + "[>83;40003;0c")), true;
          }
          _is(e4) {
            return 0 === (this._optionsService.rawOptions.termName + "").indexOf(e4);
          }
          setMode(e4) {
            for (let t7 = 0; t7 < e4.length; t7++)
              switch (e4.params[t7]) {
                case 4:
                  this._coreService.modes.insertMode = true;
                  break;
                case 20:
                  this._optionsService.options.convertEol = true;
              }
            return true;
          }
          setModePrivate(e4) {
            for (let t7 = 0; t7 < e4.length; t7++)
              switch (e4.params[t7]) {
                case 1:
                  this._coreService.decPrivateModes.applicationCursorKeys = true;
                  break;
                case 2:
                  this._charsetService.setgCharset(0, o5.DEFAULT_CHARSET), this._charsetService.setgCharset(1, o5.DEFAULT_CHARSET), this._charsetService.setgCharset(2, o5.DEFAULT_CHARSET), this._charsetService.setgCharset(3, o5.DEFAULT_CHARSET);
                  break;
                case 3:
                  this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
                  break;
                case 6:
                  this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
                  break;
                case 7:
                  this._coreService.decPrivateModes.wraparound = true;
                  break;
                case 12:
                  this._optionsService.options.cursorBlink = true;
                  break;
                case 45:
                  this._coreService.decPrivateModes.reverseWraparound = true;
                  break;
                case 66:
                  this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
                  break;
                case 9:
                  this._coreMouseService.activeProtocol = "X10";
                  break;
                case 1e3:
                  this._coreMouseService.activeProtocol = "VT200";
                  break;
                case 1002:
                  this._coreMouseService.activeProtocol = "DRAG";
                  break;
                case 1003:
                  this._coreMouseService.activeProtocol = "ANY";
                  break;
                case 1004:
                  this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
                  break;
                case 1005:
                  this._logService.debug("DECSET 1005 not supported (see #2507)");
                  break;
                case 1006:
                  this._coreMouseService.activeEncoding = "SGR";
                  break;
                case 1015:
                  this._logService.debug("DECSET 1015 not supported (see #2507)");
                  break;
                case 1016:
                  this._coreMouseService.activeEncoding = "SGR_PIXELS";
                  break;
                case 25:
                  this._coreService.isCursorHidden = false;
                  break;
                case 1048:
                  this.saveCursor();
                  break;
                case 1049:
                  this.saveCursor();
                case 47:
                case 1047:
                  this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                  break;
                case 2004:
                  this._coreService.decPrivateModes.bracketedPasteMode = true;
              }
            return true;
          }
          resetMode(e4) {
            for (let t7 = 0; t7 < e4.length; t7++)
              switch (e4.params[t7]) {
                case 4:
                  this._coreService.modes.insertMode = false;
                  break;
                case 20:
                  this._optionsService.options.convertEol = false;
              }
            return true;
          }
          resetModePrivate(e4) {
            for (let t7 = 0; t7 < e4.length; t7++)
              switch (e4.params[t7]) {
                case 1:
                  this._coreService.decPrivateModes.applicationCursorKeys = false;
                  break;
                case 3:
                  this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
                  break;
                case 6:
                  this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
                  break;
                case 7:
                  this._coreService.decPrivateModes.wraparound = false;
                  break;
                case 12:
                  this._optionsService.options.cursorBlink = false;
                  break;
                case 45:
                  this._coreService.decPrivateModes.reverseWraparound = false;
                  break;
                case 66:
                  this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
                  break;
                case 9:
                case 1e3:
                case 1002:
                case 1003:
                  this._coreMouseService.activeProtocol = "NONE";
                  break;
                case 1004:
                  this._coreService.decPrivateModes.sendFocus = false;
                  break;
                case 1005:
                  this._logService.debug("DECRST 1005 not supported (see #2507)");
                  break;
                case 1006:
                case 1016:
                  this._coreMouseService.activeEncoding = "DEFAULT";
                  break;
                case 1015:
                  this._logService.debug("DECRST 1015 not supported (see #2507)");
                  break;
                case 25:
                  this._coreService.isCursorHidden = true;
                  break;
                case 1048:
                  this.restoreCursor();
                  break;
                case 1049:
                case 47:
                case 1047:
                  this._bufferService.buffers.activateNormalBuffer(), 1049 === e4.params[t7] && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                  break;
                case 2004:
                  this._coreService.decPrivateModes.bracketedPasteMode = false;
              }
            return true;
          }
          requestMode(e4, t7) {
            const i9 = this._coreService.decPrivateModes, { activeProtocol: s12, activeEncoding: r5 } = this._coreMouseService, o6 = this._coreService, { buffers: a9, cols: h4 } = this._bufferService, { active: c13, alt: l10 } = a9, d8 = this._optionsService.rawOptions, _5 = (e5) => e5 ? 1 : 2, u10 = e4.params[0];
            return f6 = u10, v5 = t7 ? 2 === u10 ? 4 : 4 === u10 ? _5(o6.modes.insertMode) : 12 === u10 ? 3 : 20 === u10 ? _5(d8.convertEol) : 0 : 1 === u10 ? _5(i9.applicationCursorKeys) : 3 === u10 ? d8.windowOptions.setWinLines ? 80 === h4 ? 2 : 132 === h4 ? 1 : 0 : 0 : 6 === u10 ? _5(i9.origin) : 7 === u10 ? _5(i9.wraparound) : 8 === u10 ? 3 : 9 === u10 ? _5("X10" === s12) : 12 === u10 ? _5(d8.cursorBlink) : 25 === u10 ? _5(!o6.isCursorHidden) : 45 === u10 ? _5(i9.reverseWraparound) : 66 === u10 ? _5(i9.applicationKeypad) : 67 === u10 ? 4 : 1e3 === u10 ? _5("VT200" === s12) : 1002 === u10 ? _5("DRAG" === s12) : 1003 === u10 ? _5("ANY" === s12) : 1004 === u10 ? _5(i9.sendFocus) : 1005 === u10 ? 4 : 1006 === u10 ? _5("SGR" === r5) : 1015 === u10 ? 4 : 1016 === u10 ? _5("SGR_PIXELS" === r5) : 1048 === u10 ? 1 : 47 === u10 || 1047 === u10 || 1049 === u10 ? _5(c13 === l10) : 2004 === u10 ? _5(i9.bracketedPasteMode) : 0, o6.triggerDataEvent(`${n8.C0.ESC}[${t7 ? "" : "?"}${f6};${v5}$y`), true;
            var f6, v5;
          }
          _updateAttrColor(e4, t7, i9, s12, r5) {
            return 2 === t7 ? (e4 |= 50331648, e4 &= -16777216, e4 |= f5.AttributeData.fromColorRGB([i9, s12, r5])) : 5 === t7 && (e4 &= -50331904, e4 |= 33554432 | 255 & i9), e4;
          }
          _extractColor(e4, t7, i9) {
            const s12 = [0, 0, -1, 0, 0, 0];
            let r5 = 0, n9 = 0;
            do {
              if (s12[n9 + r5] = e4.params[t7 + n9], e4.hasSubParams(t7 + n9)) {
                const i10 = e4.getSubParams(t7 + n9);
                let o6 = 0;
                do {
                  5 === s12[1] && (r5 = 1), s12[n9 + o6 + 1 + r5] = i10[o6];
                } while (++o6 < i10.length && o6 + n9 + 1 + r5 < s12.length);
                break;
              }
              if (5 === s12[1] && n9 + r5 >= 2 || 2 === s12[1] && n9 + r5 >= 5)
                break;
              s12[1] && (r5 = 1);
            } while (++n9 + t7 < e4.length && n9 + r5 < s12.length);
            for (let e5 = 2; e5 < s12.length; ++e5)
              -1 === s12[e5] && (s12[e5] = 0);
            switch (s12[0]) {
              case 38:
                i9.fg = this._updateAttrColor(i9.fg, s12[1], s12[3], s12[4], s12[5]);
                break;
              case 48:
                i9.bg = this._updateAttrColor(i9.bg, s12[1], s12[3], s12[4], s12[5]);
                break;
              case 58:
                i9.extended = i9.extended.clone(), i9.extended.underlineColor = this._updateAttrColor(i9.extended.underlineColor, s12[1], s12[3], s12[4], s12[5]);
            }
            return n9;
          }
          _processUnderline(e4, t7) {
            t7.extended = t7.extended.clone(), (!~e4 || e4 > 5) && (e4 = 1), t7.extended.underlineStyle = e4, t7.fg |= 268435456, 0 === e4 && (t7.fg &= -268435457), t7.updateExtended();
          }
          _processSGR0(e4) {
            e4.fg = l9.DEFAULT_ATTR_DATA.fg, e4.bg = l9.DEFAULT_ATTR_DATA.bg, e4.extended = e4.extended.clone(), e4.extended.underlineStyle = 0, e4.extended.underlineColor &= -67108864, e4.updateExtended();
          }
          charAttributes(e4) {
            if (1 === e4.length && 0 === e4.params[0])
              return this._processSGR0(this._curAttrData), true;
            const t7 = e4.length;
            let i9;
            const s12 = this._curAttrData;
            for (let r5 = 0; r5 < t7; r5++)
              i9 = e4.params[r5], i9 >= 30 && i9 <= 37 ? (s12.fg &= -50331904, s12.fg |= 16777216 | i9 - 30) : i9 >= 40 && i9 <= 47 ? (s12.bg &= -50331904, s12.bg |= 16777216 | i9 - 40) : i9 >= 90 && i9 <= 97 ? (s12.fg &= -50331904, s12.fg |= 16777224 | i9 - 90) : i9 >= 100 && i9 <= 107 ? (s12.bg &= -50331904, s12.bg |= 16777224 | i9 - 100) : 0 === i9 ? this._processSGR0(s12) : 1 === i9 ? s12.fg |= 134217728 : 3 === i9 ? s12.bg |= 67108864 : 4 === i9 ? (s12.fg |= 268435456, this._processUnderline(e4.hasSubParams(r5) ? e4.getSubParams(r5)[0] : 1, s12)) : 5 === i9 ? s12.fg |= 536870912 : 7 === i9 ? s12.fg |= 67108864 : 8 === i9 ? s12.fg |= 1073741824 : 9 === i9 ? s12.fg |= 2147483648 : 2 === i9 ? s12.bg |= 134217728 : 21 === i9 ? this._processUnderline(2, s12) : 22 === i9 ? (s12.fg &= -134217729, s12.bg &= -134217729) : 23 === i9 ? s12.bg &= -67108865 : 24 === i9 ? (s12.fg &= -268435457, this._processUnderline(0, s12)) : 25 === i9 ? s12.fg &= -536870913 : 27 === i9 ? s12.fg &= -67108865 : 28 === i9 ? s12.fg &= -1073741825 : 29 === i9 ? s12.fg &= 2147483647 : 39 === i9 ? (s12.fg &= -67108864, s12.fg |= 16777215 & l9.DEFAULT_ATTR_DATA.fg) : 49 === i9 ? (s12.bg &= -67108864, s12.bg |= 16777215 & l9.DEFAULT_ATTR_DATA.bg) : 38 === i9 || 48 === i9 || 58 === i9 ? r5 += this._extractColor(e4, r5, s12) : 53 === i9 ? s12.bg |= 1073741824 : 55 === i9 ? s12.bg &= -1073741825 : 59 === i9 ? (s12.extended = s12.extended.clone(), s12.extended.underlineColor = -1, s12.updateExtended()) : 100 === i9 ? (s12.fg &= -67108864, s12.fg |= 16777215 & l9.DEFAULT_ATTR_DATA.fg, s12.bg &= -67108864, s12.bg |= 16777215 & l9.DEFAULT_ATTR_DATA.bg) : this._logService.debug("Unknown SGR attribute: %d.", i9);
            return true;
          }
          deviceStatus(e4) {
            switch (e4.params[0]) {
              case 5:
                this._coreService.triggerDataEvent(`${n8.C0.ESC}[0n`);
                break;
              case 6:
                const e5 = this._activeBuffer.y + 1, t7 = this._activeBuffer.x + 1;
                this._coreService.triggerDataEvent(`${n8.C0.ESC}[${e5};${t7}R`);
            }
            return true;
          }
          deviceStatusPrivate(e4) {
            if (6 === e4.params[0]) {
              const e5 = this._activeBuffer.y + 1, t7 = this._activeBuffer.x + 1;
              this._coreService.triggerDataEvent(`${n8.C0.ESC}[?${e5};${t7}R`);
            }
            return true;
          }
          softReset(e4) {
            return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = l9.DEFAULT_ATTR_DATA.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
          }
          setCursorStyle(e4) {
            const t7 = e4.params[0] || 1;
            switch (t7) {
              case 1:
              case 2:
                this._optionsService.options.cursorStyle = "block";
                break;
              case 3:
              case 4:
                this._optionsService.options.cursorStyle = "underline";
                break;
              case 5:
              case 6:
                this._optionsService.options.cursorStyle = "bar";
            }
            const i9 = t7 % 2 == 1;
            return this._optionsService.options.cursorBlink = i9, true;
          }
          setScrollRegion(e4) {
            const t7 = e4.params[0] || 1;
            let i9;
            return (e4.length < 2 || (i9 = e4.params[1]) > this._bufferService.rows || 0 === i9) && (i9 = this._bufferService.rows), i9 > t7 && (this._activeBuffer.scrollTop = t7 - 1, this._activeBuffer.scrollBottom = i9 - 1, this._setCursor(0, 0)), true;
          }
          windowOptions(e4) {
            if (!b4(e4.params[0], this._optionsService.rawOptions.windowOptions))
              return true;
            const t7 = e4.length > 1 ? e4.params[1] : 0;
            switch (e4.params[0]) {
              case 14:
                2 !== t7 && this._onRequestWindowsOptionsReport.fire(y4.GET_WIN_SIZE_PIXELS);
                break;
              case 16:
                this._onRequestWindowsOptionsReport.fire(y4.GET_CELL_SIZE_PIXELS);
                break;
              case 18:
                this._bufferService && this._coreService.triggerDataEvent(`${n8.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
                break;
              case 22:
                0 !== t7 && 2 !== t7 || (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > 10 && this._windowTitleStack.shift()), 0 !== t7 && 1 !== t7 || (this._iconNameStack.push(this._iconName), this._iconNameStack.length > 10 && this._iconNameStack.shift());
                break;
              case 23:
                0 !== t7 && 2 !== t7 || this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), 0 !== t7 && 1 !== t7 || this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
            }
            return true;
          }
          saveCursor(e4) {
            return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
          }
          restoreCursor(e4) {
            return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
          }
          setTitle(e4) {
            return this._windowTitle = e4, this._onTitleChange.fire(e4), true;
          }
          setIconName(e4) {
            return this._iconName = e4, true;
          }
          setOrReportIndexedColor(e4) {
            const t7 = [], i9 = e4.split(";");
            for (; i9.length > 1; ) {
              const e5 = i9.shift(), s12 = i9.shift();
              if (/^\d+$/.exec(e5)) {
                const i10 = parseInt(e5);
                if (L2(i10))
                  if ("?" === s12)
                    t7.push({ type: 0, index: i10 });
                  else {
                    const e6 = (0, m8.parseColor)(s12);
                    e6 && t7.push({ type: 1, index: i10, color: e6 });
                  }
              }
            }
            return t7.length && this._onColor.fire(t7), true;
          }
          setHyperlink(e4) {
            const t7 = e4.split(";");
            return !(t7.length < 2) && (t7[1] ? this._createHyperlink(t7[0], t7[1]) : !t7[0] && this._finishHyperlink());
          }
          _createHyperlink(e4, t7) {
            this._getCurrentLinkId() && this._finishHyperlink();
            const i9 = e4.split(":");
            let s12;
            const r5 = i9.findIndex((e5) => e5.startsWith("id="));
            return -1 !== r5 && (s12 = i9[r5].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: s12, uri: t7 }), this._curAttrData.updateExtended(), true;
          }
          _finishHyperlink() {
            return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
          }
          _setOrReportSpecialColor(e4, t7) {
            const i9 = e4.split(";");
            for (let e5 = 0; e5 < i9.length && !(t7 >= this._specialColors.length); ++e5, ++t7)
              if ("?" === i9[e5])
                this._onColor.fire([{ type: 0, index: this._specialColors[t7] }]);
              else {
                const s12 = (0, m8.parseColor)(i9[e5]);
                s12 && this._onColor.fire([{ type: 1, index: this._specialColors[t7], color: s12 }]);
              }
            return true;
          }
          setOrReportFgColor(e4) {
            return this._setOrReportSpecialColor(e4, 0);
          }
          setOrReportBgColor(e4) {
            return this._setOrReportSpecialColor(e4, 1);
          }
          setOrReportCursorColor(e4) {
            return this._setOrReportSpecialColor(e4, 2);
          }
          restoreIndexedColor(e4) {
            if (!e4)
              return this._onColor.fire([{ type: 2 }]), true;
            const t7 = [], i9 = e4.split(";");
            for (let e5 = 0; e5 < i9.length; ++e5)
              if (/^\d+$/.exec(i9[e5])) {
                const s12 = parseInt(i9[e5]);
                L2(s12) && t7.push({ type: 2, index: s12 });
              }
            return t7.length && this._onColor.fire(t7), true;
          }
          restoreFgColor(e4) {
            return this._onColor.fire([{ type: 2, index: 256 }]), true;
          }
          restoreBgColor(e4) {
            return this._onColor.fire([{ type: 2, index: 257 }]), true;
          }
          restoreCursorColor(e4) {
            return this._onColor.fire([{ type: 2, index: 258 }]), true;
          }
          nextLine() {
            return this._activeBuffer.x = 0, this.index(), true;
          }
          keypadApplicationMode() {
            return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
          }
          keypadNumericMode() {
            return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
          }
          selectDefaultCharset() {
            return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, o5.DEFAULT_CHARSET), true;
          }
          selectCharset(e4) {
            return 2 !== e4.length ? (this.selectDefaultCharset(), true) : ("/" === e4[0] || this._charsetService.setgCharset(S2[e4[0]], o5.CHARSETS[e4[1]] || o5.DEFAULT_CHARSET), true);
          }
          index() {
            return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
          }
          tabSet() {
            return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
          }
          reverseIndex() {
            if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
              const e4 = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
              this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e4, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
            } else
              this._activeBuffer.y--, this._restrictCursor();
            return true;
          }
          fullReset() {
            return this._parser.reset(), this._onRequestReset.fire(), true;
          }
          reset() {
            this._curAttrData = l9.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l9.DEFAULT_ATTR_DATA.clone();
          }
          _eraseAttrData() {
            return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= 67108863 & this._curAttrData.bg, this._eraseAttrDataInternal;
          }
          setgLevel(e4) {
            return this._charsetService.setgLevel(e4), true;
          }
          screenAlignmentPattern() {
            const e4 = new u9.CellData();
            e4.content = 1 << 22 | "E".charCodeAt(0), e4.fg = this._curAttrData.fg, e4.bg = this._curAttrData.bg, this._setCursor(0, 0);
            for (let t7 = 0; t7 < this._bufferService.rows; ++t7) {
              const i9 = this._activeBuffer.ybase + this._activeBuffer.y + t7, s12 = this._activeBuffer.lines.get(i9);
              s12 && (s12.fill(e4), s12.isWrapped = false);
            }
            return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
          }
          requestStatusString(e4, t7) {
            const i9 = this._bufferService.buffer, s12 = this._optionsService.rawOptions;
            return ((e5) => (this._coreService.triggerDataEvent(`${n8.C0.ESC}${e5}${n8.C0.ESC}\\`), true))('"q' === e4 ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : '"p' === e4 ? 'P1$r61;1"p' : "r" === e4 ? `P1$r${i9.scrollTop + 1};${i9.scrollBottom + 1}r` : "m" === e4 ? "P1$r0m" : " q" === e4 ? `P1$r${{ block: 2, underline: 4, bar: 6 }[s12.cursorStyle] - (s12.cursorBlink ? 1 : 0)} q` : "P0$r");
          }
          markRangeDirty(e4, t7) {
            this._dirtyRowTracker.markRangeDirty(e4, t7);
          }
        }
        t6.InputHandler = E4;
        let k2 = class {
          constructor(e4) {
            this._bufferService = e4, this.clearRange();
          }
          clearRange() {
            this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
          }
          markDirty(e4) {
            e4 < this.start ? this.start = e4 : e4 > this.end && (this.end = e4);
          }
          markRangeDirty(e4, t7) {
            e4 > t7 && (w3 = e4, e4 = t7, t7 = w3), e4 < this.start && (this.start = e4), t7 > this.end && (this.end = t7);
          }
          markAllDirty() {
            this.markRangeDirty(0, this._bufferService.rows - 1);
          }
        };
        function L2(e4) {
          return 0 <= e4 && e4 < 256;
        }
        k2 = s11([r4(0, v4.IBufferService)], k2);
      }, 844: (e3, t6) => {
        function i8(e4) {
          for (const t7 of e4)
            t7.dispose();
          e4.length = 0;
        }
        Object.defineProperty(t6, "__esModule", { value: true }), t6.getDisposeArrayDisposable = t6.disposeArray = t6.toDisposable = t6.MutableDisposable = t6.Disposable = void 0, t6.Disposable = class {
          constructor() {
            this._disposables = [], this._isDisposed = false;
          }
          dispose() {
            this._isDisposed = true;
            for (const e4 of this._disposables)
              e4.dispose();
            this._disposables.length = 0;
          }
          register(e4) {
            return this._disposables.push(e4), e4;
          }
          unregister(e4) {
            const t7 = this._disposables.indexOf(e4);
            -1 !== t7 && this._disposables.splice(t7, 1);
          }
        }, t6.MutableDisposable = class {
          constructor() {
            this._isDisposed = false;
          }
          get value() {
            return this._isDisposed ? void 0 : this._value;
          }
          set value(e4) {
            var t7;
            this._isDisposed || e4 === this._value || (null === (t7 = this._value) || void 0 === t7 || t7.dispose(), this._value = e4);
          }
          clear() {
            this.value = void 0;
          }
          dispose() {
            var e4;
            this._isDisposed = true, null === (e4 = this._value) || void 0 === e4 || e4.dispose(), this._value = void 0;
          }
        }, t6.toDisposable = function(e4) {
          return { dispose: e4 };
        }, t6.disposeArray = i8, t6.getDisposeArrayDisposable = function(e4) {
          return { dispose: () => i8(e4) };
        };
      }, 1505: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.FourKeyMap = t6.TwoKeyMap = void 0;
        class i8 {
          constructor() {
            this._data = {};
          }
          set(e4, t7, i9) {
            this._data[e4] || (this._data[e4] = {}), this._data[e4][t7] = i9;
          }
          get(e4, t7) {
            return this._data[e4] ? this._data[e4][t7] : void 0;
          }
          clear() {
            this._data = {};
          }
        }
        t6.TwoKeyMap = i8, t6.FourKeyMap = class {
          constructor() {
            this._data = new i8();
          }
          set(e4, t7, s11, r4, n8) {
            this._data.get(e4, t7) || this._data.set(e4, t7, new i8()), this._data.get(e4, t7).set(s11, r4, n8);
          }
          get(e4, t7, i9, s11) {
            var r4;
            return null === (r4 = this._data.get(e4, t7)) || void 0 === r4 ? void 0 : r4.get(i9, s11);
          }
          clear() {
            this._data.clear();
          }
        };
      }, 6114: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.isChromeOS = t6.isLinux = t6.isWindows = t6.isIphone = t6.isIpad = t6.isMac = t6.getSafariVersion = t6.isSafari = t6.isLegacyEdge = t6.isFirefox = t6.isNode = void 0, t6.isNode = "undefined" == typeof navigator;
        const i8 = t6.isNode ? "node" : navigator.userAgent, s11 = t6.isNode ? "node" : navigator.platform;
        t6.isFirefox = i8.includes("Firefox"), t6.isLegacyEdge = i8.includes("Edge"), t6.isSafari = /^((?!chrome|android).)*safari/i.test(i8), t6.getSafariVersion = function() {
          if (!t6.isSafari)
            return 0;
          const e4 = i8.match(/Version\/(\d+)/);
          return null === e4 || e4.length < 2 ? 0 : parseInt(e4[1]);
        }, t6.isMac = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(s11), t6.isIpad = "iPad" === s11, t6.isIphone = "iPhone" === s11, t6.isWindows = ["Windows", "Win16", "Win32", "WinCE"].includes(s11), t6.isLinux = s11.indexOf("Linux") >= 0, t6.isChromeOS = /\bCrOS\b/.test(i8);
      }, 6106: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.SortedList = void 0;
        let i8 = 0;
        t6.SortedList = class {
          constructor(e4) {
            this._getKey = e4, this._array = [];
          }
          clear() {
            this._array.length = 0;
          }
          insert(e4) {
            0 !== this._array.length ? (i8 = this._search(this._getKey(e4)), this._array.splice(i8, 0, e4)) : this._array.push(e4);
          }
          delete(e4) {
            if (0 === this._array.length)
              return false;
            const t7 = this._getKey(e4);
            if (void 0 === t7)
              return false;
            if (i8 = this._search(t7), -1 === i8)
              return false;
            if (this._getKey(this._array[i8]) !== t7)
              return false;
            do {
              if (this._array[i8] === e4)
                return this._array.splice(i8, 1), true;
            } while (++i8 < this._array.length && this._getKey(this._array[i8]) === t7);
            return false;
          }
          *getKeyIterator(e4) {
            if (0 !== this._array.length && (i8 = this._search(e4), !(i8 < 0 || i8 >= this._array.length) && this._getKey(this._array[i8]) === e4))
              do {
                yield this._array[i8];
              } while (++i8 < this._array.length && this._getKey(this._array[i8]) === e4);
          }
          forEachByKey(e4, t7) {
            if (0 !== this._array.length && (i8 = this._search(e4), !(i8 < 0 || i8 >= this._array.length) && this._getKey(this._array[i8]) === e4))
              do {
                t7(this._array[i8]);
              } while (++i8 < this._array.length && this._getKey(this._array[i8]) === e4);
          }
          values() {
            return [...this._array].values();
          }
          _search(e4) {
            let t7 = 0, i9 = this._array.length - 1;
            for (; i9 >= t7; ) {
              let s11 = t7 + i9 >> 1;
              const r4 = this._getKey(this._array[s11]);
              if (r4 > e4)
                i9 = s11 - 1;
              else {
                if (!(r4 < e4)) {
                  for (; s11 > 0 && this._getKey(this._array[s11 - 1]) === e4; )
                    s11--;
                  return s11;
                }
                t7 = s11 + 1;
              }
            }
            return t7;
          }
        };
      }, 7226: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DebouncedIdleTask = t6.IdleTaskQueue = t6.PriorityTaskQueue = void 0;
        const s11 = i8(6114);
        class r4 {
          constructor() {
            this._tasks = [], this._i = 0;
          }
          enqueue(e4) {
            this._tasks.push(e4), this._start();
          }
          flush() {
            for (; this._i < this._tasks.length; )
              this._tasks[this._i]() || this._i++;
            this.clear();
          }
          clear() {
            this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
          }
          _start() {
            this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
          }
          _process(e4) {
            this._idleCallback = void 0;
            let t7 = 0, i9 = 0, s12 = e4.timeRemaining(), r5 = 0;
            for (; this._i < this._tasks.length; ) {
              if (t7 = Date.now(), this._tasks[this._i]() || this._i++, t7 = Math.max(1, Date.now() - t7), i9 = Math.max(t7, i9), r5 = e4.timeRemaining(), 1.5 * i9 > r5)
                return s12 - t7 < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s12 - t7))}ms`), void this._start();
              s12 = r5;
            }
            this.clear();
          }
        }
        class n8 extends r4 {
          _requestCallback(e4) {
            return setTimeout(() => e4(this._createDeadline(16)));
          }
          _cancelCallback(e4) {
            clearTimeout(e4);
          }
          _createDeadline(e4) {
            const t7 = Date.now() + e4;
            return { timeRemaining: () => Math.max(0, t7 - Date.now()) };
          }
        }
        t6.PriorityTaskQueue = n8, t6.IdleTaskQueue = !s11.isNode && "requestIdleCallback" in window ? class extends r4 {
          _requestCallback(e4) {
            return requestIdleCallback(e4);
          }
          _cancelCallback(e4) {
            cancelIdleCallback(e4);
          }
        } : n8, t6.DebouncedIdleTask = class {
          constructor() {
            this._queue = new t6.IdleTaskQueue();
          }
          set(e4) {
            this._queue.clear(), this._queue.enqueue(e4);
          }
          flush() {
            this._queue.flush();
          }
        };
      }, 9282: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.updateWindowsModeWrappedState = void 0;
        const s11 = i8(643);
        t6.updateWindowsModeWrappedState = function(e4) {
          const t7 = e4.buffer.lines.get(e4.buffer.ybase + e4.buffer.y - 1), i9 = null == t7 ? void 0 : t7.get(e4.cols - 1), r4 = e4.buffer.lines.get(e4.buffer.ybase + e4.buffer.y);
          r4 && i9 && (r4.isWrapped = i9[s11.CHAR_DATA_CODE_INDEX] !== s11.NULL_CELL_CODE && i9[s11.CHAR_DATA_CODE_INDEX] !== s11.WHITESPACE_CELL_CODE);
        };
      }, 3734: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ExtendedAttrs = t6.AttributeData = void 0;
        class i8 {
          constructor() {
            this.fg = 0, this.bg = 0, this.extended = new s11();
          }
          static toColorRGB(e4) {
            return [e4 >>> 16 & 255, e4 >>> 8 & 255, 255 & e4];
          }
          static fromColorRGB(e4) {
            return (255 & e4[0]) << 16 | (255 & e4[1]) << 8 | 255 & e4[2];
          }
          clone() {
            const e4 = new i8();
            return e4.fg = this.fg, e4.bg = this.bg, e4.extended = this.extended.clone(), e4;
          }
          isInverse() {
            return 67108864 & this.fg;
          }
          isBold() {
            return 134217728 & this.fg;
          }
          isUnderline() {
            return this.hasExtendedAttrs() && 0 !== this.extended.underlineStyle ? 1 : 268435456 & this.fg;
          }
          isBlink() {
            return 536870912 & this.fg;
          }
          isInvisible() {
            return 1073741824 & this.fg;
          }
          isItalic() {
            return 67108864 & this.bg;
          }
          isDim() {
            return 134217728 & this.bg;
          }
          isStrikethrough() {
            return 2147483648 & this.fg;
          }
          isProtected() {
            return 536870912 & this.bg;
          }
          isOverline() {
            return 1073741824 & this.bg;
          }
          getFgColorMode() {
            return 50331648 & this.fg;
          }
          getBgColorMode() {
            return 50331648 & this.bg;
          }
          isFgRGB() {
            return 50331648 == (50331648 & this.fg);
          }
          isBgRGB() {
            return 50331648 == (50331648 & this.bg);
          }
          isFgPalette() {
            return 16777216 == (50331648 & this.fg) || 33554432 == (50331648 & this.fg);
          }
          isBgPalette() {
            return 16777216 == (50331648 & this.bg) || 33554432 == (50331648 & this.bg);
          }
          isFgDefault() {
            return 0 == (50331648 & this.fg);
          }
          isBgDefault() {
            return 0 == (50331648 & this.bg);
          }
          isAttributeDefault() {
            return 0 === this.fg && 0 === this.bg;
          }
          getFgColor() {
            switch (50331648 & this.fg) {
              case 16777216:
              case 33554432:
                return 255 & this.fg;
              case 50331648:
                return 16777215 & this.fg;
              default:
                return -1;
            }
          }
          getBgColor() {
            switch (50331648 & this.bg) {
              case 16777216:
              case 33554432:
                return 255 & this.bg;
              case 50331648:
                return 16777215 & this.bg;
              default:
                return -1;
            }
          }
          hasExtendedAttrs() {
            return 268435456 & this.bg;
          }
          updateExtended() {
            this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
          }
          getUnderlineColor() {
            if (268435456 & this.bg && ~this.extended.underlineColor)
              switch (50331648 & this.extended.underlineColor) {
                case 16777216:
                case 33554432:
                  return 255 & this.extended.underlineColor;
                case 50331648:
                  return 16777215 & this.extended.underlineColor;
                default:
                  return this.getFgColor();
              }
            return this.getFgColor();
          }
          getUnderlineColorMode() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 & this.extended.underlineColor : this.getFgColorMode();
          }
          isUnderlineColorRGB() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 == (50331648 & this.extended.underlineColor) : this.isFgRGB();
          }
          isUnderlineColorPalette() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 16777216 == (50331648 & this.extended.underlineColor) || 33554432 == (50331648 & this.extended.underlineColor) : this.isFgPalette();
          }
          isUnderlineColorDefault() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 0 == (50331648 & this.extended.underlineColor) : this.isFgDefault();
          }
          getUnderlineStyle() {
            return 268435456 & this.fg ? 268435456 & this.bg ? this.extended.underlineStyle : 1 : 0;
          }
        }
        t6.AttributeData = i8;
        class s11 {
          get ext() {
            return this._urlId ? -469762049 & this._ext | this.underlineStyle << 26 : this._ext;
          }
          set ext(e4) {
            this._ext = e4;
          }
          get underlineStyle() {
            return this._urlId ? 5 : (469762048 & this._ext) >> 26;
          }
          set underlineStyle(e4) {
            this._ext &= -469762049, this._ext |= e4 << 26 & 469762048;
          }
          get underlineColor() {
            return 67108863 & this._ext;
          }
          set underlineColor(e4) {
            this._ext &= -67108864, this._ext |= 67108863 & e4;
          }
          get urlId() {
            return this._urlId;
          }
          set urlId(e4) {
            this._urlId = e4;
          }
          constructor(e4 = 0, t7 = 0) {
            this._ext = 0, this._urlId = 0, this._ext = e4, this._urlId = t7;
          }
          clone() {
            return new s11(this._ext, this._urlId);
          }
          isEmpty() {
            return 0 === this.underlineStyle && 0 === this._urlId;
          }
        }
        t6.ExtendedAttrs = s11;
      }, 9092: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Buffer = t6.MAX_BUFFER_SIZE = void 0;
        const s11 = i8(6349), r4 = i8(7226), n8 = i8(3734), o5 = i8(8437), a8 = i8(4634), h3 = i8(511), c12 = i8(643), l9 = i8(4863), d7 = i8(7116);
        t6.MAX_BUFFER_SIZE = 4294967295, t6.Buffer = class {
          constructor(e4, t7, i9) {
            this._hasScrollback = e4, this._optionsService = t7, this._bufferService = i9, this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.tabs = {}, this.savedY = 0, this.savedX = 0, this.savedCurAttrData = o5.DEFAULT_ATTR_DATA.clone(), this.savedCharset = d7.DEFAULT_CHARSET, this.markers = [], this._nullCell = h3.CellData.fromCharData([0, c12.NULL_CELL_CHAR, c12.NULL_CELL_WIDTH, c12.NULL_CELL_CODE]), this._whitespaceCell = h3.CellData.fromCharData([0, c12.WHITESPACE_CELL_CHAR, c12.WHITESPACE_CELL_WIDTH, c12.WHITESPACE_CELL_CODE]), this._isClearing = false, this._memoryCleanupQueue = new r4.IdleTaskQueue(), this._memoryCleanupPosition = 0, this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new s11.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          getNullCell(e4) {
            return e4 ? (this._nullCell.fg = e4.fg, this._nullCell.bg = e4.bg, this._nullCell.extended = e4.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new n8.ExtendedAttrs()), this._nullCell;
          }
          getWhitespaceCell(e4) {
            return e4 ? (this._whitespaceCell.fg = e4.fg, this._whitespaceCell.bg = e4.bg, this._whitespaceCell.extended = e4.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new n8.ExtendedAttrs()), this._whitespaceCell;
          }
          getBlankLine(e4, t7) {
            return new o5.BufferLine(this._bufferService.cols, this.getNullCell(e4), t7);
          }
          get hasScrollback() {
            return this._hasScrollback && this.lines.maxLength > this._rows;
          }
          get isCursorInViewport() {
            const e4 = this.ybase + this.y - this.ydisp;
            return e4 >= 0 && e4 < this._rows;
          }
          _getCorrectBufferLength(e4) {
            if (!this._hasScrollback)
              return e4;
            const i9 = e4 + this._optionsService.rawOptions.scrollback;
            return i9 > t6.MAX_BUFFER_SIZE ? t6.MAX_BUFFER_SIZE : i9;
          }
          fillViewportRows(e4) {
            if (0 === this.lines.length) {
              void 0 === e4 && (e4 = o5.DEFAULT_ATTR_DATA);
              let t7 = this._rows;
              for (; t7--; )
                this.lines.push(this.getBlankLine(e4));
            }
          }
          clear() {
            this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new s11.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          resize(e4, t7) {
            const i9 = this.getNullCell(o5.DEFAULT_ATTR_DATA);
            let s12 = 0;
            const r5 = this._getCorrectBufferLength(t7);
            if (r5 > this.lines.maxLength && (this.lines.maxLength = r5), this.lines.length > 0) {
              if (this._cols < e4)
                for (let t8 = 0; t8 < this.lines.length; t8++)
                  s12 += +this.lines.get(t8).resize(e4, i9);
              let n9 = 0;
              if (this._rows < t7)
                for (let s13 = this._rows; s13 < t7; s13++)
                  this.lines.length < t7 + this.ybase && (this._optionsService.rawOptions.windowsMode || void 0 !== this._optionsService.rawOptions.windowsPty.backend || void 0 !== this._optionsService.rawOptions.windowsPty.buildNumber ? this.lines.push(new o5.BufferLine(e4, i9)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + n9 + 1 ? (this.ybase--, n9++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new o5.BufferLine(e4, i9)));
              else
                for (let e5 = this._rows; e5 > t7; e5--)
                  this.lines.length > t7 + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
              if (r5 < this.lines.maxLength) {
                const e5 = this.lines.length - r5;
                e5 > 0 && (this.lines.trimStart(e5), this.ybase = Math.max(this.ybase - e5, 0), this.ydisp = Math.max(this.ydisp - e5, 0), this.savedY = Math.max(this.savedY - e5, 0)), this.lines.maxLength = r5;
              }
              this.x = Math.min(this.x, e4 - 1), this.y = Math.min(this.y, t7 - 1), n9 && (this.y += n9), this.savedX = Math.min(this.savedX, e4 - 1), this.scrollTop = 0;
            }
            if (this.scrollBottom = t7 - 1, this._isReflowEnabled && (this._reflow(e4, t7), this._cols > e4))
              for (let t8 = 0; t8 < this.lines.length; t8++)
                s12 += +this.lines.get(t8).resize(e4, i9);
            this._cols = e4, this._rows = t7, this._memoryCleanupQueue.clear(), s12 > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
          }
          _batchedMemoryCleanup() {
            let e4 = true;
            this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, e4 = false);
            let t7 = 0;
            for (; this._memoryCleanupPosition < this.lines.length; )
              if (t7 += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), t7 > 100)
                return true;
            return e4;
          }
          get _isReflowEnabled() {
            const e4 = this._optionsService.rawOptions.windowsPty;
            return e4 && e4.buildNumber ? this._hasScrollback && "conpty" === e4.backend && e4.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
          }
          _reflow(e4, t7) {
            this._cols !== e4 && (e4 > this._cols ? this._reflowLarger(e4, t7) : this._reflowSmaller(e4, t7));
          }
          _reflowLarger(e4, t7) {
            const i9 = (0, a8.reflowLargerGetLinesToRemove)(this.lines, this._cols, e4, this.ybase + this.y, this.getNullCell(o5.DEFAULT_ATTR_DATA));
            if (i9.length > 0) {
              const s12 = (0, a8.reflowLargerCreateNewLayout)(this.lines, i9);
              (0, a8.reflowLargerApplyNewLayout)(this.lines, s12.layout), this._reflowLargerAdjustViewport(e4, t7, s12.countRemoved);
            }
          }
          _reflowLargerAdjustViewport(e4, t7, i9) {
            const s12 = this.getNullCell(o5.DEFAULT_ATTR_DATA);
            let r5 = i9;
            for (; r5-- > 0; )
              0 === this.ybase ? (this.y > 0 && this.y--, this.lines.length < t7 && this.lines.push(new o5.BufferLine(e4, s12))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
            this.savedY = Math.max(this.savedY - i9, 0);
          }
          _reflowSmaller(e4, t7) {
            const i9 = this.getNullCell(o5.DEFAULT_ATTR_DATA), s12 = [];
            let r5 = 0;
            for (let n9 = this.lines.length - 1; n9 >= 0; n9--) {
              let h4 = this.lines.get(n9);
              if (!h4 || !h4.isWrapped && h4.getTrimmedLength() <= e4)
                continue;
              const c13 = [h4];
              for (; h4.isWrapped && n9 > 0; )
                h4 = this.lines.get(--n9), c13.unshift(h4);
              const l10 = this.ybase + this.y;
              if (l10 >= n9 && l10 < n9 + c13.length)
                continue;
              const d8 = c13[c13.length - 1].getTrimmedLength(), _4 = (0, a8.reflowSmallerGetNewLineLengths)(c13, this._cols, e4), u9 = _4.length - c13.length;
              let f5;
              f5 = 0 === this.ybase && this.y !== this.lines.length - 1 ? Math.max(0, this.y - this.lines.maxLength + u9) : Math.max(0, this.lines.length - this.lines.maxLength + u9);
              const v4 = [];
              for (let e5 = 0; e5 < u9; e5++) {
                const e6 = this.getBlankLine(o5.DEFAULT_ATTR_DATA, true);
                v4.push(e6);
              }
              v4.length > 0 && (s12.push({ start: n9 + c13.length + r5, newLines: v4 }), r5 += v4.length), c13.push(...v4);
              let p5 = _4.length - 1, g6 = _4[p5];
              0 === g6 && (p5--, g6 = _4[p5]);
              let m8 = c13.length - u9 - 1, S2 = d8;
              for (; m8 >= 0; ) {
                const e5 = Math.min(S2, g6);
                if (void 0 === c13[p5])
                  break;
                if (c13[p5].copyCellsFrom(c13[m8], S2 - e5, g6 - e5, e5, true), g6 -= e5, 0 === g6 && (p5--, g6 = _4[p5]), S2 -= e5, 0 === S2) {
                  m8--;
                  const e6 = Math.max(m8, 0);
                  S2 = (0, a8.getWrappedLineTrimmedLength)(c13, e6, this._cols);
                }
              }
              for (let t8 = 0; t8 < c13.length; t8++)
                _4[t8] < e4 && c13[t8].setCell(_4[t8], i9);
              let C3 = u9 - f5;
              for (; C3-- > 0; )
                0 === this.ybase ? this.y < t7 - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + r5) - t7 && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
              this.savedY = Math.min(this.savedY + u9, this.ybase + t7 - 1);
            }
            if (s12.length > 0) {
              const e5 = [], t8 = [];
              for (let e6 = 0; e6 < this.lines.length; e6++)
                t8.push(this.lines.get(e6));
              const i10 = this.lines.length;
              let n9 = i10 - 1, o6 = 0, a9 = s12[o6];
              this.lines.length = Math.min(this.lines.maxLength, this.lines.length + r5);
              let h4 = 0;
              for (let c14 = Math.min(this.lines.maxLength - 1, i10 + r5 - 1); c14 >= 0; c14--)
                if (a9 && a9.start > n9 + h4) {
                  for (let e6 = a9.newLines.length - 1; e6 >= 0; e6--)
                    this.lines.set(c14--, a9.newLines[e6]);
                  c14++, e5.push({ index: n9 + 1, amount: a9.newLines.length }), h4 += a9.newLines.length, a9 = s12[++o6];
                } else
                  this.lines.set(c14, t8[n9--]);
              let c13 = 0;
              for (let t9 = e5.length - 1; t9 >= 0; t9--)
                e5[t9].index += c13, this.lines.onInsertEmitter.fire(e5[t9]), c13 += e5[t9].amount;
              const l10 = Math.max(0, i10 + r5 - this.lines.maxLength);
              l10 > 0 && this.lines.onTrimEmitter.fire(l10);
            }
          }
          translateBufferLineToString(e4, t7, i9 = 0, s12) {
            const r5 = this.lines.get(e4);
            return r5 ? r5.translateToString(t7, i9, s12) : "";
          }
          getWrappedRangeForLine(e4) {
            let t7 = e4, i9 = e4;
            for (; t7 > 0 && this.lines.get(t7).isWrapped; )
              t7--;
            for (; i9 + 1 < this.lines.length && this.lines.get(i9 + 1).isWrapped; )
              i9++;
            return { first: t7, last: i9 };
          }
          setupTabStops(e4) {
            for (null != e4 ? this.tabs[e4] || (e4 = this.prevStop(e4)) : (this.tabs = {}, e4 = 0); e4 < this._cols; e4 += this._optionsService.rawOptions.tabStopWidth)
              this.tabs[e4] = true;
          }
          prevStop(e4) {
            for (null == e4 && (e4 = this.x); !this.tabs[--e4] && e4 > 0; )
              ;
            return e4 >= this._cols ? this._cols - 1 : e4 < 0 ? 0 : e4;
          }
          nextStop(e4) {
            for (null == e4 && (e4 = this.x); !this.tabs[++e4] && e4 < this._cols; )
              ;
            return e4 >= this._cols ? this._cols - 1 : e4 < 0 ? 0 : e4;
          }
          clearMarkers(e4) {
            this._isClearing = true;
            for (let t7 = 0; t7 < this.markers.length; t7++)
              this.markers[t7].line === e4 && (this.markers[t7].dispose(), this.markers.splice(t7--, 1));
            this._isClearing = false;
          }
          clearAllMarkers() {
            this._isClearing = true;
            for (let e4 = 0; e4 < this.markers.length; e4++)
              this.markers[e4].dispose(), this.markers.splice(e4--, 1);
            this._isClearing = false;
          }
          addMarker(e4) {
            const t7 = new l9.Marker(e4);
            return this.markers.push(t7), t7.register(this.lines.onTrim((e5) => {
              t7.line -= e5, t7.line < 0 && t7.dispose();
            })), t7.register(this.lines.onInsert((e5) => {
              t7.line >= e5.index && (t7.line += e5.amount);
            })), t7.register(this.lines.onDelete((e5) => {
              t7.line >= e5.index && t7.line < e5.index + e5.amount && t7.dispose(), t7.line > e5.index && (t7.line -= e5.amount);
            })), t7.register(t7.onDispose(() => this._removeMarker(t7))), t7;
          }
          _removeMarker(e4) {
            this._isClearing || this.markers.splice(this.markers.indexOf(e4), 1);
          }
        };
      }, 8437: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferLine = t6.DEFAULT_ATTR_DATA = void 0;
        const s11 = i8(3734), r4 = i8(511), n8 = i8(643), o5 = i8(482);
        t6.DEFAULT_ATTR_DATA = Object.freeze(new s11.AttributeData());
        let a8 = 0;
        class h3 {
          constructor(e4, t7, i9 = false) {
            this.isWrapped = i9, this._combined = {}, this._extendedAttrs = {}, this._data = new Uint32Array(3 * e4);
            const s12 = t7 || r4.CellData.fromCharData([0, n8.NULL_CELL_CHAR, n8.NULL_CELL_WIDTH, n8.NULL_CELL_CODE]);
            for (let t8 = 0; t8 < e4; ++t8)
              this.setCell(t8, s12);
            this.length = e4;
          }
          get(e4) {
            const t7 = this._data[3 * e4 + 0], i9 = 2097151 & t7;
            return [this._data[3 * e4 + 1], 2097152 & t7 ? this._combined[e4] : i9 ? (0, o5.stringFromCodePoint)(i9) : "", t7 >> 22, 2097152 & t7 ? this._combined[e4].charCodeAt(this._combined[e4].length - 1) : i9];
          }
          set(e4, t7) {
            this._data[3 * e4 + 1] = t7[n8.CHAR_DATA_ATTR_INDEX], t7[n8.CHAR_DATA_CHAR_INDEX].length > 1 ? (this._combined[e4] = t7[1], this._data[3 * e4 + 0] = 2097152 | e4 | t7[n8.CHAR_DATA_WIDTH_INDEX] << 22) : this._data[3 * e4 + 0] = t7[n8.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | t7[n8.CHAR_DATA_WIDTH_INDEX] << 22;
          }
          getWidth(e4) {
            return this._data[3 * e4 + 0] >> 22;
          }
          hasWidth(e4) {
            return 12582912 & this._data[3 * e4 + 0];
          }
          getFg(e4) {
            return this._data[3 * e4 + 1];
          }
          getBg(e4) {
            return this._data[3 * e4 + 2];
          }
          hasContent(e4) {
            return 4194303 & this._data[3 * e4 + 0];
          }
          getCodePoint(e4) {
            const t7 = this._data[3 * e4 + 0];
            return 2097152 & t7 ? this._combined[e4].charCodeAt(this._combined[e4].length - 1) : 2097151 & t7;
          }
          isCombined(e4) {
            return 2097152 & this._data[3 * e4 + 0];
          }
          getString(e4) {
            const t7 = this._data[3 * e4 + 0];
            return 2097152 & t7 ? this._combined[e4] : 2097151 & t7 ? (0, o5.stringFromCodePoint)(2097151 & t7) : "";
          }
          isProtected(e4) {
            return 536870912 & this._data[3 * e4 + 2];
          }
          loadCell(e4, t7) {
            return a8 = 3 * e4, t7.content = this._data[a8 + 0], t7.fg = this._data[a8 + 1], t7.bg = this._data[a8 + 2], 2097152 & t7.content && (t7.combinedData = this._combined[e4]), 268435456 & t7.bg && (t7.extended = this._extendedAttrs[e4]), t7;
          }
          setCell(e4, t7) {
            2097152 & t7.content && (this._combined[e4] = t7.combinedData), 268435456 & t7.bg && (this._extendedAttrs[e4] = t7.extended), this._data[3 * e4 + 0] = t7.content, this._data[3 * e4 + 1] = t7.fg, this._data[3 * e4 + 2] = t7.bg;
          }
          setCellFromCodePoint(e4, t7, i9, s12, r5, n9) {
            268435456 & r5 && (this._extendedAttrs[e4] = n9), this._data[3 * e4 + 0] = t7 | i9 << 22, this._data[3 * e4 + 1] = s12, this._data[3 * e4 + 2] = r5;
          }
          addCodepointToCell(e4, t7) {
            let i9 = this._data[3 * e4 + 0];
            2097152 & i9 ? this._combined[e4] += (0, o5.stringFromCodePoint)(t7) : (2097151 & i9 ? (this._combined[e4] = (0, o5.stringFromCodePoint)(2097151 & i9) + (0, o5.stringFromCodePoint)(t7), i9 &= -2097152, i9 |= 2097152) : i9 = t7 | 1 << 22, this._data[3 * e4 + 0] = i9);
          }
          insertCells(e4, t7, i9, n9) {
            if ((e4 %= this.length) && 2 === this.getWidth(e4 - 1) && this.setCellFromCodePoint(e4 - 1, 0, 1, (null == n9 ? void 0 : n9.fg) || 0, (null == n9 ? void 0 : n9.bg) || 0, (null == n9 ? void 0 : n9.extended) || new s11.ExtendedAttrs()), t7 < this.length - e4) {
              const s12 = new r4.CellData();
              for (let i10 = this.length - e4 - t7 - 1; i10 >= 0; --i10)
                this.setCell(e4 + t7 + i10, this.loadCell(e4 + i10, s12));
              for (let s13 = 0; s13 < t7; ++s13)
                this.setCell(e4 + s13, i9);
            } else
              for (let t8 = e4; t8 < this.length; ++t8)
                this.setCell(t8, i9);
            2 === this.getWidth(this.length - 1) && this.setCellFromCodePoint(this.length - 1, 0, 1, (null == n9 ? void 0 : n9.fg) || 0, (null == n9 ? void 0 : n9.bg) || 0, (null == n9 ? void 0 : n9.extended) || new s11.ExtendedAttrs());
          }
          deleteCells(e4, t7, i9, n9) {
            if (e4 %= this.length, t7 < this.length - e4) {
              const s12 = new r4.CellData();
              for (let i10 = 0; i10 < this.length - e4 - t7; ++i10)
                this.setCell(e4 + i10, this.loadCell(e4 + t7 + i10, s12));
              for (let e5 = this.length - t7; e5 < this.length; ++e5)
                this.setCell(e5, i9);
            } else
              for (let t8 = e4; t8 < this.length; ++t8)
                this.setCell(t8, i9);
            e4 && 2 === this.getWidth(e4 - 1) && this.setCellFromCodePoint(e4 - 1, 0, 1, (null == n9 ? void 0 : n9.fg) || 0, (null == n9 ? void 0 : n9.bg) || 0, (null == n9 ? void 0 : n9.extended) || new s11.ExtendedAttrs()), 0 !== this.getWidth(e4) || this.hasContent(e4) || this.setCellFromCodePoint(e4, 0, 1, (null == n9 ? void 0 : n9.fg) || 0, (null == n9 ? void 0 : n9.bg) || 0, (null == n9 ? void 0 : n9.extended) || new s11.ExtendedAttrs());
          }
          replaceCells(e4, t7, i9, r5, n9 = false) {
            if (n9)
              for (e4 && 2 === this.getWidth(e4 - 1) && !this.isProtected(e4 - 1) && this.setCellFromCodePoint(e4 - 1, 0, 1, (null == r5 ? void 0 : r5.fg) || 0, (null == r5 ? void 0 : r5.bg) || 0, (null == r5 ? void 0 : r5.extended) || new s11.ExtendedAttrs()), t7 < this.length && 2 === this.getWidth(t7 - 1) && !this.isProtected(t7) && this.setCellFromCodePoint(t7, 0, 1, (null == r5 ? void 0 : r5.fg) || 0, (null == r5 ? void 0 : r5.bg) || 0, (null == r5 ? void 0 : r5.extended) || new s11.ExtendedAttrs()); e4 < t7 && e4 < this.length; )
                this.isProtected(e4) || this.setCell(e4, i9), e4++;
            else
              for (e4 && 2 === this.getWidth(e4 - 1) && this.setCellFromCodePoint(e4 - 1, 0, 1, (null == r5 ? void 0 : r5.fg) || 0, (null == r5 ? void 0 : r5.bg) || 0, (null == r5 ? void 0 : r5.extended) || new s11.ExtendedAttrs()), t7 < this.length && 2 === this.getWidth(t7 - 1) && this.setCellFromCodePoint(t7, 0, 1, (null == r5 ? void 0 : r5.fg) || 0, (null == r5 ? void 0 : r5.bg) || 0, (null == r5 ? void 0 : r5.extended) || new s11.ExtendedAttrs()); e4 < t7 && e4 < this.length; )
                this.setCell(e4++, i9);
          }
          resize(e4, t7) {
            if (e4 === this.length)
              return 4 * this._data.length * 2 < this._data.buffer.byteLength;
            const i9 = 3 * e4;
            if (e4 > this.length) {
              if (this._data.buffer.byteLength >= 4 * i9)
                this._data = new Uint32Array(this._data.buffer, 0, i9);
              else {
                const e5 = new Uint32Array(i9);
                e5.set(this._data), this._data = e5;
              }
              for (let i10 = this.length; i10 < e4; ++i10)
                this.setCell(i10, t7);
            } else {
              this._data = this._data.subarray(0, i9);
              const t8 = Object.keys(this._combined);
              for (let i10 = 0; i10 < t8.length; i10++) {
                const s13 = parseInt(t8[i10], 10);
                s13 >= e4 && delete this._combined[s13];
              }
              const s12 = Object.keys(this._extendedAttrs);
              for (let t9 = 0; t9 < s12.length; t9++) {
                const i10 = parseInt(s12[t9], 10);
                i10 >= e4 && delete this._extendedAttrs[i10];
              }
            }
            return this.length = e4, 4 * i9 * 2 < this._data.buffer.byteLength;
          }
          cleanupMemory() {
            if (4 * this._data.length * 2 < this._data.buffer.byteLength) {
              const e4 = new Uint32Array(this._data.length);
              return e4.set(this._data), this._data = e4, 1;
            }
            return 0;
          }
          fill(e4, t7 = false) {
            if (t7)
              for (let t8 = 0; t8 < this.length; ++t8)
                this.isProtected(t8) || this.setCell(t8, e4);
            else {
              this._combined = {}, this._extendedAttrs = {};
              for (let t8 = 0; t8 < this.length; ++t8)
                this.setCell(t8, e4);
            }
          }
          copyFrom(e4) {
            this.length !== e4.length ? this._data = new Uint32Array(e4._data) : this._data.set(e4._data), this.length = e4.length, this._combined = {};
            for (const t7 in e4._combined)
              this._combined[t7] = e4._combined[t7];
            this._extendedAttrs = {};
            for (const t7 in e4._extendedAttrs)
              this._extendedAttrs[t7] = e4._extendedAttrs[t7];
            this.isWrapped = e4.isWrapped;
          }
          clone() {
            const e4 = new h3(0);
            e4._data = new Uint32Array(this._data), e4.length = this.length;
            for (const t7 in this._combined)
              e4._combined[t7] = this._combined[t7];
            for (const t7 in this._extendedAttrs)
              e4._extendedAttrs[t7] = this._extendedAttrs[t7];
            return e4.isWrapped = this.isWrapped, e4;
          }
          getTrimmedLength() {
            for (let e4 = this.length - 1; e4 >= 0; --e4)
              if (4194303 & this._data[3 * e4 + 0])
                return e4 + (this._data[3 * e4 + 0] >> 22);
            return 0;
          }
          getNoBgTrimmedLength() {
            for (let e4 = this.length - 1; e4 >= 0; --e4)
              if (4194303 & this._data[3 * e4 + 0] || 50331648 & this._data[3 * e4 + 2])
                return e4 + (this._data[3 * e4 + 0] >> 22);
            return 0;
          }
          copyCellsFrom(e4, t7, i9, s12, r5) {
            const n9 = e4._data;
            if (r5)
              for (let r6 = s12 - 1; r6 >= 0; r6--) {
                for (let e5 = 0; e5 < 3; e5++)
                  this._data[3 * (i9 + r6) + e5] = n9[3 * (t7 + r6) + e5];
                268435456 & n9[3 * (t7 + r6) + 2] && (this._extendedAttrs[i9 + r6] = e4._extendedAttrs[t7 + r6]);
              }
            else
              for (let r6 = 0; r6 < s12; r6++) {
                for (let e5 = 0; e5 < 3; e5++)
                  this._data[3 * (i9 + r6) + e5] = n9[3 * (t7 + r6) + e5];
                268435456 & n9[3 * (t7 + r6) + 2] && (this._extendedAttrs[i9 + r6] = e4._extendedAttrs[t7 + r6]);
              }
            const o6 = Object.keys(e4._combined);
            for (let s13 = 0; s13 < o6.length; s13++) {
              const r6 = parseInt(o6[s13], 10);
              r6 >= t7 && (this._combined[r6 - t7 + i9] = e4._combined[r6]);
            }
          }
          translateToString(e4 = false, t7 = 0, i9 = this.length) {
            e4 && (i9 = Math.min(i9, this.getTrimmedLength()));
            let s12 = "";
            for (; t7 < i9; ) {
              const e5 = this._data[3 * t7 + 0], i10 = 2097151 & e5;
              s12 += 2097152 & e5 ? this._combined[t7] : i10 ? (0, o5.stringFromCodePoint)(i10) : n8.WHITESPACE_CELL_CHAR, t7 += e5 >> 22 || 1;
            }
            return s12;
          }
        }
        t6.BufferLine = h3;
      }, 4841: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.getRangeLength = void 0, t6.getRangeLength = function(e4, t7) {
          if (e4.start.y > e4.end.y)
            throw new Error(`Buffer range end (${e4.end.x}, ${e4.end.y}) cannot be before start (${e4.start.x}, ${e4.start.y})`);
          return t7 * (e4.end.y - e4.start.y) + (e4.end.x - e4.start.x + 1);
        };
      }, 4634: (e3, t6) => {
        function i8(e4, t7, i9) {
          if (t7 === e4.length - 1)
            return e4[t7].getTrimmedLength();
          const s11 = !e4[t7].hasContent(i9 - 1) && 1 === e4[t7].getWidth(i9 - 1), r4 = 2 === e4[t7 + 1].getWidth(0);
          return s11 && r4 ? i9 - 1 : i9;
        }
        Object.defineProperty(t6, "__esModule", { value: true }), t6.getWrappedLineTrimmedLength = t6.reflowSmallerGetNewLineLengths = t6.reflowLargerApplyNewLayout = t6.reflowLargerCreateNewLayout = t6.reflowLargerGetLinesToRemove = void 0, t6.reflowLargerGetLinesToRemove = function(e4, t7, s11, r4, n8) {
          const o5 = [];
          for (let a8 = 0; a8 < e4.length - 1; a8++) {
            let h3 = a8, c12 = e4.get(++h3);
            if (!c12.isWrapped)
              continue;
            const l9 = [e4.get(a8)];
            for (; h3 < e4.length && c12.isWrapped; )
              l9.push(c12), c12 = e4.get(++h3);
            if (r4 >= a8 && r4 < h3) {
              a8 += l9.length - 1;
              continue;
            }
            let d7 = 0, _4 = i8(l9, d7, t7), u9 = 1, f5 = 0;
            for (; u9 < l9.length; ) {
              const e5 = i8(l9, u9, t7), r5 = e5 - f5, o6 = s11 - _4, a9 = Math.min(r5, o6);
              l9[d7].copyCellsFrom(l9[u9], f5, _4, a9, false), _4 += a9, _4 === s11 && (d7++, _4 = 0), f5 += a9, f5 === e5 && (u9++, f5 = 0), 0 === _4 && 0 !== d7 && 2 === l9[d7 - 1].getWidth(s11 - 1) && (l9[d7].copyCellsFrom(l9[d7 - 1], s11 - 1, _4++, 1, false), l9[d7 - 1].setCell(s11 - 1, n8));
            }
            l9[d7].replaceCells(_4, s11, n8);
            let v4 = 0;
            for (let e5 = l9.length - 1; e5 > 0 && (e5 > d7 || 0 === l9[e5].getTrimmedLength()); e5--)
              v4++;
            v4 > 0 && (o5.push(a8 + l9.length - v4), o5.push(v4)), a8 += l9.length - 1;
          }
          return o5;
        }, t6.reflowLargerCreateNewLayout = function(e4, t7) {
          const i9 = [];
          let s11 = 0, r4 = t7[s11], n8 = 0;
          for (let o5 = 0; o5 < e4.length; o5++)
            if (r4 === o5) {
              const i10 = t7[++s11];
              e4.onDeleteEmitter.fire({ index: o5 - n8, amount: i10 }), o5 += i10 - 1, n8 += i10, r4 = t7[++s11];
            } else
              i9.push(o5);
          return { layout: i9, countRemoved: n8 };
        }, t6.reflowLargerApplyNewLayout = function(e4, t7) {
          const i9 = [];
          for (let s11 = 0; s11 < t7.length; s11++)
            i9.push(e4.get(t7[s11]));
          for (let t8 = 0; t8 < i9.length; t8++)
            e4.set(t8, i9[t8]);
          e4.length = t7.length;
        }, t6.reflowSmallerGetNewLineLengths = function(e4, t7, s11) {
          const r4 = [], n8 = e4.map((s12, r5) => i8(e4, r5, t7)).reduce((e5, t8) => e5 + t8);
          let o5 = 0, a8 = 0, h3 = 0;
          for (; h3 < n8; ) {
            if (n8 - h3 < s11) {
              r4.push(n8 - h3);
              break;
            }
            o5 += s11;
            const c12 = i8(e4, a8, t7);
            o5 > c12 && (o5 -= c12, a8++);
            const l9 = 2 === e4[a8].getWidth(o5 - 1);
            l9 && o5--;
            const d7 = l9 ? s11 - 1 : s11;
            r4.push(d7), h3 += d7;
          }
          return r4;
        }, t6.getWrappedLineTrimmedLength = i8;
      }, 5295: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferSet = void 0;
        const s11 = i8(8460), r4 = i8(844), n8 = i8(9092);
        class o5 extends r4.Disposable {
          constructor(e4, t7) {
            super(), this._optionsService = e4, this._bufferService = t7, this._onBufferActivate = this.register(new s11.EventEmitter()), this.onBufferActivate = this._onBufferActivate.event, this.reset(), this.register(this._optionsService.onSpecificOptionChange("scrollback", () => this.resize(this._bufferService.cols, this._bufferService.rows))), this.register(this._optionsService.onSpecificOptionChange("tabStopWidth", () => this.setupTabStops()));
          }
          reset() {
            this._normal = new n8.Buffer(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new n8.Buffer(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
          }
          get alt() {
            return this._alt;
          }
          get active() {
            return this._activeBuffer;
          }
          get normal() {
            return this._normal;
          }
          activateNormalBuffer() {
            this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
          }
          activateAltBuffer(e4) {
            this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e4), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
          }
          resize(e4, t7) {
            this._normal.resize(e4, t7), this._alt.resize(e4, t7), this.setupTabStops(e4);
          }
          setupTabStops(e4) {
            this._normal.setupTabStops(e4), this._alt.setupTabStops(e4);
          }
        }
        t6.BufferSet = o5;
      }, 511: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CellData = void 0;
        const s11 = i8(482), r4 = i8(643), n8 = i8(3734);
        class o5 extends n8.AttributeData {
          constructor() {
            super(...arguments), this.content = 0, this.fg = 0, this.bg = 0, this.extended = new n8.ExtendedAttrs(), this.combinedData = "";
          }
          static fromCharData(e4) {
            const t7 = new o5();
            return t7.setFromCharData(e4), t7;
          }
          isCombined() {
            return 2097152 & this.content;
          }
          getWidth() {
            return this.content >> 22;
          }
          getChars() {
            return 2097152 & this.content ? this.combinedData : 2097151 & this.content ? (0, s11.stringFromCodePoint)(2097151 & this.content) : "";
          }
          getCode() {
            return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : 2097151 & this.content;
          }
          setFromCharData(e4) {
            this.fg = e4[r4.CHAR_DATA_ATTR_INDEX], this.bg = 0;
            let t7 = false;
            if (e4[r4.CHAR_DATA_CHAR_INDEX].length > 2)
              t7 = true;
            else if (2 === e4[r4.CHAR_DATA_CHAR_INDEX].length) {
              const i9 = e4[r4.CHAR_DATA_CHAR_INDEX].charCodeAt(0);
              if (55296 <= i9 && i9 <= 56319) {
                const s12 = e4[r4.CHAR_DATA_CHAR_INDEX].charCodeAt(1);
                56320 <= s12 && s12 <= 57343 ? this.content = 1024 * (i9 - 55296) + s12 - 56320 + 65536 | e4[r4.CHAR_DATA_WIDTH_INDEX] << 22 : t7 = true;
              } else
                t7 = true;
            } else
              this.content = e4[r4.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | e4[r4.CHAR_DATA_WIDTH_INDEX] << 22;
            t7 && (this.combinedData = e4[r4.CHAR_DATA_CHAR_INDEX], this.content = 2097152 | e4[r4.CHAR_DATA_WIDTH_INDEX] << 22);
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t6.CellData = o5;
      }, 643: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.WHITESPACE_CELL_CODE = t6.WHITESPACE_CELL_WIDTH = t6.WHITESPACE_CELL_CHAR = t6.NULL_CELL_CODE = t6.NULL_CELL_WIDTH = t6.NULL_CELL_CHAR = t6.CHAR_DATA_CODE_INDEX = t6.CHAR_DATA_WIDTH_INDEX = t6.CHAR_DATA_CHAR_INDEX = t6.CHAR_DATA_ATTR_INDEX = t6.DEFAULT_EXT = t6.DEFAULT_ATTR = t6.DEFAULT_COLOR = void 0, t6.DEFAULT_COLOR = 0, t6.DEFAULT_ATTR = 256 | t6.DEFAULT_COLOR << 9, t6.DEFAULT_EXT = 0, t6.CHAR_DATA_ATTR_INDEX = 0, t6.CHAR_DATA_CHAR_INDEX = 1, t6.CHAR_DATA_WIDTH_INDEX = 2, t6.CHAR_DATA_CODE_INDEX = 3, t6.NULL_CELL_CHAR = "", t6.NULL_CELL_WIDTH = 1, t6.NULL_CELL_CODE = 0, t6.WHITESPACE_CELL_CHAR = " ", t6.WHITESPACE_CELL_WIDTH = 1, t6.WHITESPACE_CELL_CODE = 32;
      }, 4863: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Marker = void 0;
        const s11 = i8(8460), r4 = i8(844);
        class n8 {
          get id() {
            return this._id;
          }
          constructor(e4) {
            this.line = e4, this.isDisposed = false, this._disposables = [], this._id = n8._nextId++, this._onDispose = this.register(new s11.EventEmitter()), this.onDispose = this._onDispose.event;
          }
          dispose() {
            this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), (0, r4.disposeArray)(this._disposables), this._disposables.length = 0);
          }
          register(e4) {
            return this._disposables.push(e4), e4;
          }
        }
        t6.Marker = n8, n8._nextId = 1;
      }, 7116: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DEFAULT_CHARSET = t6.CHARSETS = void 0, t6.CHARSETS = {}, t6.DEFAULT_CHARSET = t6.CHARSETS.B, t6.CHARSETS[0] = { "`": "\u25C6", a: "\u2592", b: "\u2409", c: "\u240C", d: "\u240D", e: "\u240A", f: "\xB0", g: "\xB1", h: "\u2424", i: "\u240B", j: "\u2518", k: "\u2510", l: "\u250C", m: "\u2514", n: "\u253C", o: "\u23BA", p: "\u23BB", q: "\u2500", r: "\u23BC", s: "\u23BD", t: "\u251C", u: "\u2524", v: "\u2534", w: "\u252C", x: "\u2502", y: "\u2264", z: "\u2265", "{": "\u03C0", "|": "\u2260", "}": "\xA3", "~": "\xB7" }, t6.CHARSETS.A = { "#": "\xA3" }, t6.CHARSETS.B = void 0, t6.CHARSETS[4] = { "#": "\xA3", "@": "\xBE", "[": "ij", "\\": "\xBD", "]": "|", "{": "\xA8", "|": "f", "}": "\xBC", "~": "\xB4" }, t6.CHARSETS.C = t6.CHARSETS[5] = { "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t6.CHARSETS.R = { "#": "\xA3", "@": "\xE0", "[": "\xB0", "\\": "\xE7", "]": "\xA7", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xA8" }, t6.CHARSETS.Q = { "@": "\xE0", "[": "\xE2", "\\": "\xE7", "]": "\xEA", "^": "\xEE", "`": "\xF4", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xFB" }, t6.CHARSETS.K = { "@": "\xA7", "[": "\xC4", "\\": "\xD6", "]": "\xDC", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xDF" }, t6.CHARSETS.Y = { "#": "\xA3", "@": "\xA7", "[": "\xB0", "\\": "\xE7", "]": "\xE9", "`": "\xF9", "{": "\xE0", "|": "\xF2", "}": "\xE8", "~": "\xEC" }, t6.CHARSETS.E = t6.CHARSETS[6] = { "@": "\xC4", "[": "\xC6", "\\": "\xD8", "]": "\xC5", "^": "\xDC", "`": "\xE4", "{": "\xE6", "|": "\xF8", "}": "\xE5", "~": "\xFC" }, t6.CHARSETS.Z = { "#": "\xA3", "@": "\xA7", "[": "\xA1", "\\": "\xD1", "]": "\xBF", "{": "\xB0", "|": "\xF1", "}": "\xE7" }, t6.CHARSETS.H = t6.CHARSETS[7] = { "@": "\xC9", "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t6.CHARSETS["="] = { "#": "\xF9", "@": "\xE0", "[": "\xE9", "\\": "\xE7", "]": "\xEA", "^": "\xEE", _: "\xE8", "`": "\xF4", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xFB" };
      }, 2584: (e3, t6) => {
        var i8, s11, r4;
        Object.defineProperty(t6, "__esModule", { value: true }), t6.C1_ESCAPED = t6.C1 = t6.C0 = void 0, function(e4) {
          e4.NUL = "\0", e4.SOH = "", e4.STX = "", e4.ETX = "", e4.EOT = "", e4.ENQ = "", e4.ACK = "", e4.BEL = "\x07", e4.BS = "\b", e4.HT = "	", e4.LF = "\n", e4.VT = "\v", e4.FF = "\f", e4.CR = "\r", e4.SO = "", e4.SI = "", e4.DLE = "", e4.DC1 = "", e4.DC2 = "", e4.DC3 = "", e4.DC4 = "", e4.NAK = "", e4.SYN = "", e4.ETB = "", e4.CAN = "", e4.EM = "", e4.SUB = "", e4.ESC = "\x1B", e4.FS = "", e4.GS = "", e4.RS = "", e4.US = "", e4.SP = " ", e4.DEL = "\x7F";
        }(i8 || (t6.C0 = i8 = {})), function(e4) {
          e4.PAD = "\x80", e4.HOP = "\x81", e4.BPH = "\x82", e4.NBH = "\x83", e4.IND = "\x84", e4.NEL = "\x85", e4.SSA = "\x86", e4.ESA = "\x87", e4.HTS = "\x88", e4.HTJ = "\x89", e4.VTS = "\x8A", e4.PLD = "\x8B", e4.PLU = "\x8C", e4.RI = "\x8D", e4.SS2 = "\x8E", e4.SS3 = "\x8F", e4.DCS = "\x90", e4.PU1 = "\x91", e4.PU2 = "\x92", e4.STS = "\x93", e4.CCH = "\x94", e4.MW = "\x95", e4.SPA = "\x96", e4.EPA = "\x97", e4.SOS = "\x98", e4.SGCI = "\x99", e4.SCI = "\x9A", e4.CSI = "\x9B", e4.ST = "\x9C", e4.OSC = "\x9D", e4.PM = "\x9E", e4.APC = "\x9F";
        }(s11 || (t6.C1 = s11 = {})), function(e4) {
          e4.ST = `${i8.ESC}\\`;
        }(r4 || (t6.C1_ESCAPED = r4 = {}));
      }, 7399: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.evaluateKeyboardEvent = void 0;
        const s11 = i8(2584), r4 = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
        t6.evaluateKeyboardEvent = function(e4, t7, i9, n8) {
          const o5 = { type: 0, cancel: false, key: void 0 }, a8 = (e4.shiftKey ? 1 : 0) | (e4.altKey ? 2 : 0) | (e4.ctrlKey ? 4 : 0) | (e4.metaKey ? 8 : 0);
          switch (e4.keyCode) {
            case 0:
              "UIKeyInputUpArrow" === e4.key ? o5.key = t7 ? s11.C0.ESC + "OA" : s11.C0.ESC + "[A" : "UIKeyInputLeftArrow" === e4.key ? o5.key = t7 ? s11.C0.ESC + "OD" : s11.C0.ESC + "[D" : "UIKeyInputRightArrow" === e4.key ? o5.key = t7 ? s11.C0.ESC + "OC" : s11.C0.ESC + "[C" : "UIKeyInputDownArrow" === e4.key && (o5.key = t7 ? s11.C0.ESC + "OB" : s11.C0.ESC + "[B");
              break;
            case 8:
              if (e4.altKey) {
                o5.key = s11.C0.ESC + s11.C0.DEL;
                break;
              }
              o5.key = s11.C0.DEL;
              break;
            case 9:
              if (e4.shiftKey) {
                o5.key = s11.C0.ESC + "[Z";
                break;
              }
              o5.key = s11.C0.HT, o5.cancel = true;
              break;
            case 13:
              o5.key = e4.altKey ? s11.C0.ESC + s11.C0.CR : s11.C0.CR, o5.cancel = true;
              break;
            case 27:
              o5.key = s11.C0.ESC, e4.altKey && (o5.key = s11.C0.ESC + s11.C0.ESC), o5.cancel = true;
              break;
            case 37:
              if (e4.metaKey)
                break;
              a8 ? (o5.key = s11.C0.ESC + "[1;" + (a8 + 1) + "D", o5.key === s11.C0.ESC + "[1;3D" && (o5.key = s11.C0.ESC + (i9 ? "b" : "[1;5D"))) : o5.key = t7 ? s11.C0.ESC + "OD" : s11.C0.ESC + "[D";
              break;
            case 39:
              if (e4.metaKey)
                break;
              a8 ? (o5.key = s11.C0.ESC + "[1;" + (a8 + 1) + "C", o5.key === s11.C0.ESC + "[1;3C" && (o5.key = s11.C0.ESC + (i9 ? "f" : "[1;5C"))) : o5.key = t7 ? s11.C0.ESC + "OC" : s11.C0.ESC + "[C";
              break;
            case 38:
              if (e4.metaKey)
                break;
              a8 ? (o5.key = s11.C0.ESC + "[1;" + (a8 + 1) + "A", i9 || o5.key !== s11.C0.ESC + "[1;3A" || (o5.key = s11.C0.ESC + "[1;5A")) : o5.key = t7 ? s11.C0.ESC + "OA" : s11.C0.ESC + "[A";
              break;
            case 40:
              if (e4.metaKey)
                break;
              a8 ? (o5.key = s11.C0.ESC + "[1;" + (a8 + 1) + "B", i9 || o5.key !== s11.C0.ESC + "[1;3B" || (o5.key = s11.C0.ESC + "[1;5B")) : o5.key = t7 ? s11.C0.ESC + "OB" : s11.C0.ESC + "[B";
              break;
            case 45:
              e4.shiftKey || e4.ctrlKey || (o5.key = s11.C0.ESC + "[2~");
              break;
            case 46:
              o5.key = a8 ? s11.C0.ESC + "[3;" + (a8 + 1) + "~" : s11.C0.ESC + "[3~";
              break;
            case 36:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "H" : t7 ? s11.C0.ESC + "OH" : s11.C0.ESC + "[H";
              break;
            case 35:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "F" : t7 ? s11.C0.ESC + "OF" : s11.C0.ESC + "[F";
              break;
            case 33:
              e4.shiftKey ? o5.type = 2 : e4.ctrlKey ? o5.key = s11.C0.ESC + "[5;" + (a8 + 1) + "~" : o5.key = s11.C0.ESC + "[5~";
              break;
            case 34:
              e4.shiftKey ? o5.type = 3 : e4.ctrlKey ? o5.key = s11.C0.ESC + "[6;" + (a8 + 1) + "~" : o5.key = s11.C0.ESC + "[6~";
              break;
            case 112:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "P" : s11.C0.ESC + "OP";
              break;
            case 113:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "Q" : s11.C0.ESC + "OQ";
              break;
            case 114:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "R" : s11.C0.ESC + "OR";
              break;
            case 115:
              o5.key = a8 ? s11.C0.ESC + "[1;" + (a8 + 1) + "S" : s11.C0.ESC + "OS";
              break;
            case 116:
              o5.key = a8 ? s11.C0.ESC + "[15;" + (a8 + 1) + "~" : s11.C0.ESC + "[15~";
              break;
            case 117:
              o5.key = a8 ? s11.C0.ESC + "[17;" + (a8 + 1) + "~" : s11.C0.ESC + "[17~";
              break;
            case 118:
              o5.key = a8 ? s11.C0.ESC + "[18;" + (a8 + 1) + "~" : s11.C0.ESC + "[18~";
              break;
            case 119:
              o5.key = a8 ? s11.C0.ESC + "[19;" + (a8 + 1) + "~" : s11.C0.ESC + "[19~";
              break;
            case 120:
              o5.key = a8 ? s11.C0.ESC + "[20;" + (a8 + 1) + "~" : s11.C0.ESC + "[20~";
              break;
            case 121:
              o5.key = a8 ? s11.C0.ESC + "[21;" + (a8 + 1) + "~" : s11.C0.ESC + "[21~";
              break;
            case 122:
              o5.key = a8 ? s11.C0.ESC + "[23;" + (a8 + 1) + "~" : s11.C0.ESC + "[23~";
              break;
            case 123:
              o5.key = a8 ? s11.C0.ESC + "[24;" + (a8 + 1) + "~" : s11.C0.ESC + "[24~";
              break;
            default:
              if (!e4.ctrlKey || e4.shiftKey || e4.altKey || e4.metaKey)
                if (i9 && !n8 || !e4.altKey || e4.metaKey)
                  !i9 || e4.altKey || e4.ctrlKey || e4.shiftKey || !e4.metaKey ? e4.key && !e4.ctrlKey && !e4.altKey && !e4.metaKey && e4.keyCode >= 48 && 1 === e4.key.length ? o5.key = e4.key : e4.key && e4.ctrlKey && ("_" === e4.key && (o5.key = s11.C0.US), "@" === e4.key && (o5.key = s11.C0.NUL)) : 65 === e4.keyCode && (o5.type = 1);
                else {
                  const t8 = r4[e4.keyCode], i10 = null == t8 ? void 0 : t8[e4.shiftKey ? 1 : 0];
                  if (i10)
                    o5.key = s11.C0.ESC + i10;
                  else if (e4.keyCode >= 65 && e4.keyCode <= 90) {
                    const t9 = e4.ctrlKey ? e4.keyCode - 64 : e4.keyCode + 32;
                    let i11 = String.fromCharCode(t9);
                    e4.shiftKey && (i11 = i11.toUpperCase()), o5.key = s11.C0.ESC + i11;
                  } else if (32 === e4.keyCode)
                    o5.key = s11.C0.ESC + (e4.ctrlKey ? s11.C0.NUL : " ");
                  else if ("Dead" === e4.key && e4.code.startsWith("Key")) {
                    let t9 = e4.code.slice(3, 4);
                    e4.shiftKey || (t9 = t9.toLowerCase()), o5.key = s11.C0.ESC + t9, o5.cancel = true;
                  }
                }
              else
                e4.keyCode >= 65 && e4.keyCode <= 90 ? o5.key = String.fromCharCode(e4.keyCode - 64) : 32 === e4.keyCode ? o5.key = s11.C0.NUL : e4.keyCode >= 51 && e4.keyCode <= 55 ? o5.key = String.fromCharCode(e4.keyCode - 51 + 27) : 56 === e4.keyCode ? o5.key = s11.C0.DEL : 219 === e4.keyCode ? o5.key = s11.C0.ESC : 220 === e4.keyCode ? o5.key = s11.C0.FS : 221 === e4.keyCode && (o5.key = s11.C0.GS);
          }
          return o5;
        };
      }, 482: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Utf8ToUtf32 = t6.StringToUtf32 = t6.utf32ToString = t6.stringFromCodePoint = void 0, t6.stringFromCodePoint = function(e4) {
          return e4 > 65535 ? (e4 -= 65536, String.fromCharCode(55296 + (e4 >> 10)) + String.fromCharCode(e4 % 1024 + 56320)) : String.fromCharCode(e4);
        }, t6.utf32ToString = function(e4, t7 = 0, i8 = e4.length) {
          let s11 = "";
          for (let r4 = t7; r4 < i8; ++r4) {
            let t8 = e4[r4];
            t8 > 65535 ? (t8 -= 65536, s11 += String.fromCharCode(55296 + (t8 >> 10)) + String.fromCharCode(t8 % 1024 + 56320)) : s11 += String.fromCharCode(t8);
          }
          return s11;
        }, t6.StringToUtf32 = class {
          constructor() {
            this._interim = 0;
          }
          clear() {
            this._interim = 0;
          }
          decode(e4, t7) {
            const i8 = e4.length;
            if (!i8)
              return 0;
            let s11 = 0, r4 = 0;
            if (this._interim) {
              const i9 = e4.charCodeAt(r4++);
              56320 <= i9 && i9 <= 57343 ? t7[s11++] = 1024 * (this._interim - 55296) + i9 - 56320 + 65536 : (t7[s11++] = this._interim, t7[s11++] = i9), this._interim = 0;
            }
            for (let n8 = r4; n8 < i8; ++n8) {
              const r5 = e4.charCodeAt(n8);
              if (55296 <= r5 && r5 <= 56319) {
                if (++n8 >= i8)
                  return this._interim = r5, s11;
                const o5 = e4.charCodeAt(n8);
                56320 <= o5 && o5 <= 57343 ? t7[s11++] = 1024 * (r5 - 55296) + o5 - 56320 + 65536 : (t7[s11++] = r5, t7[s11++] = o5);
              } else
                65279 !== r5 && (t7[s11++] = r5);
            }
            return s11;
          }
        }, t6.Utf8ToUtf32 = class {
          constructor() {
            this.interim = new Uint8Array(3);
          }
          clear() {
            this.interim.fill(0);
          }
          decode(e4, t7) {
            const i8 = e4.length;
            if (!i8)
              return 0;
            let s11, r4, n8, o5, a8 = 0, h3 = 0, c12 = 0;
            if (this.interim[0]) {
              let s12 = false, r5 = this.interim[0];
              r5 &= 192 == (224 & r5) ? 31 : 224 == (240 & r5) ? 15 : 7;
              let n9, o6 = 0;
              for (; (n9 = 63 & this.interim[++o6]) && o6 < 4; )
                r5 <<= 6, r5 |= n9;
              const h4 = 192 == (224 & this.interim[0]) ? 2 : 224 == (240 & this.interim[0]) ? 3 : 4, l10 = h4 - o6;
              for (; c12 < l10; ) {
                if (c12 >= i8)
                  return 0;
                if (n9 = e4[c12++], 128 != (192 & n9)) {
                  c12--, s12 = true;
                  break;
                }
                this.interim[o6++] = n9, r5 <<= 6, r5 |= 63 & n9;
              }
              s12 || (2 === h4 ? r5 < 128 ? c12-- : t7[a8++] = r5 : 3 === h4 ? r5 < 2048 || r5 >= 55296 && r5 <= 57343 || 65279 === r5 || (t7[a8++] = r5) : r5 < 65536 || r5 > 1114111 || (t7[a8++] = r5)), this.interim.fill(0);
            }
            const l9 = i8 - 4;
            let d7 = c12;
            for (; d7 < i8; ) {
              for (; !(!(d7 < l9) || 128 & (s11 = e4[d7]) || 128 & (r4 = e4[d7 + 1]) || 128 & (n8 = e4[d7 + 2]) || 128 & (o5 = e4[d7 + 3])); )
                t7[a8++] = s11, t7[a8++] = r4, t7[a8++] = n8, t7[a8++] = o5, d7 += 4;
              if (s11 = e4[d7++], s11 < 128)
                t7[a8++] = s11;
              else if (192 == (224 & s11)) {
                if (d7 >= i8)
                  return this.interim[0] = s11, a8;
                if (r4 = e4[d7++], 128 != (192 & r4)) {
                  d7--;
                  continue;
                }
                if (h3 = (31 & s11) << 6 | 63 & r4, h3 < 128) {
                  d7--;
                  continue;
                }
                t7[a8++] = h3;
              } else if (224 == (240 & s11)) {
                if (d7 >= i8)
                  return this.interim[0] = s11, a8;
                if (r4 = e4[d7++], 128 != (192 & r4)) {
                  d7--;
                  continue;
                }
                if (d7 >= i8)
                  return this.interim[0] = s11, this.interim[1] = r4, a8;
                if (n8 = e4[d7++], 128 != (192 & n8)) {
                  d7--;
                  continue;
                }
                if (h3 = (15 & s11) << 12 | (63 & r4) << 6 | 63 & n8, h3 < 2048 || h3 >= 55296 && h3 <= 57343 || 65279 === h3)
                  continue;
                t7[a8++] = h3;
              } else if (240 == (248 & s11)) {
                if (d7 >= i8)
                  return this.interim[0] = s11, a8;
                if (r4 = e4[d7++], 128 != (192 & r4)) {
                  d7--;
                  continue;
                }
                if (d7 >= i8)
                  return this.interim[0] = s11, this.interim[1] = r4, a8;
                if (n8 = e4[d7++], 128 != (192 & n8)) {
                  d7--;
                  continue;
                }
                if (d7 >= i8)
                  return this.interim[0] = s11, this.interim[1] = r4, this.interim[2] = n8, a8;
                if (o5 = e4[d7++], 128 != (192 & o5)) {
                  d7--;
                  continue;
                }
                if (h3 = (7 & s11) << 18 | (63 & r4) << 12 | (63 & n8) << 6 | 63 & o5, h3 < 65536 || h3 > 1114111)
                  continue;
                t7[a8++] = h3;
              }
            }
            return a8;
          }
        };
      }, 225: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.UnicodeV6 = void 0;
        const i8 = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]], s11 = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
        let r4;
        t6.UnicodeV6 = class {
          constructor() {
            if (this.version = "6", !r4) {
              r4 = new Uint8Array(65536), r4.fill(1), r4[0] = 0, r4.fill(0, 1, 32), r4.fill(0, 127, 160), r4.fill(2, 4352, 4448), r4[9001] = 2, r4[9002] = 2, r4.fill(2, 11904, 42192), r4[12351] = 1, r4.fill(2, 44032, 55204), r4.fill(2, 63744, 64256), r4.fill(2, 65040, 65050), r4.fill(2, 65072, 65136), r4.fill(2, 65280, 65377), r4.fill(2, 65504, 65511);
              for (let e4 = 0; e4 < i8.length; ++e4)
                r4.fill(0, i8[e4][0], i8[e4][1] + 1);
            }
          }
          wcwidth(e4) {
            return e4 < 32 ? 0 : e4 < 127 ? 1 : e4 < 65536 ? r4[e4] : function(e5, t7) {
              let i9, s12 = 0, r5 = t7.length - 1;
              if (e5 < t7[0][0] || e5 > t7[r5][1])
                return false;
              for (; r5 >= s12; )
                if (i9 = s12 + r5 >> 1, e5 > t7[i9][1])
                  s12 = i9 + 1;
                else {
                  if (!(e5 < t7[i9][0]))
                    return true;
                  r5 = i9 - 1;
                }
              return false;
            }(e4, s11) ? 0 : e4 >= 131072 && e4 <= 196605 || e4 >= 196608 && e4 <= 262141 ? 2 : 1;
          }
        };
      }, 5981: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.WriteBuffer = void 0;
        const s11 = i8(8460), r4 = i8(844);
        class n8 extends r4.Disposable {
          constructor(e4) {
            super(), this._action = e4, this._writeBuffer = [], this._callbacks = [], this._pendingData = 0, this._bufferOffset = 0, this._isSyncWriting = false, this._syncCalls = 0, this._didUserInput = false, this._onWriteParsed = this.register(new s11.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event;
          }
          handleUserInput() {
            this._didUserInput = true;
          }
          writeSync(e4, t7) {
            if (void 0 !== t7 && this._syncCalls > t7)
              return void (this._syncCalls = 0);
            if (this._pendingData += e4.length, this._writeBuffer.push(e4), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting)
              return;
            let i9;
            for (this._isSyncWriting = true; i9 = this._writeBuffer.shift(); ) {
              this._action(i9);
              const e5 = this._callbacks.shift();
              e5 && e5();
            }
            this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
          }
          write(e4, t7) {
            if (this._pendingData > 5e7)
              throw new Error("write data discarded, use flow control to avoid losing data");
            if (!this._writeBuffer.length) {
              if (this._bufferOffset = 0, this._didUserInput)
                return this._didUserInput = false, this._pendingData += e4.length, this._writeBuffer.push(e4), this._callbacks.push(t7), void this._innerWrite();
              setTimeout(() => this._innerWrite());
            }
            this._pendingData += e4.length, this._writeBuffer.push(e4), this._callbacks.push(t7);
          }
          _innerWrite(e4 = 0, t7 = true) {
            const i9 = e4 || Date.now();
            for (; this._writeBuffer.length > this._bufferOffset; ) {
              const e5 = this._writeBuffer[this._bufferOffset], s12 = this._action(e5, t7);
              if (s12) {
                const e6 = (e7) => Date.now() - i9 >= 12 ? setTimeout(() => this._innerWrite(0, e7)) : this._innerWrite(i9, e7);
                return void s12.catch((e7) => (queueMicrotask(() => {
                  throw e7;
                }), Promise.resolve(false))).then(e6);
              }
              const r5 = this._callbacks[this._bufferOffset];
              if (r5 && r5(), this._bufferOffset++, this._pendingData -= e5.length, Date.now() - i9 >= 12)
                break;
            }
            this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > 50 && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout(() => this._innerWrite())) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
          }
        }
        t6.WriteBuffer = n8;
      }, 5941: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.toRgbString = t6.parseColor = void 0;
        const i8 = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, s11 = /^[\da-f]+$/;
        function r4(e4, t7) {
          const i9 = e4.toString(16), s12 = i9.length < 2 ? "0" + i9 : i9;
          switch (t7) {
            case 4:
              return i9[0];
            case 8:
              return s12;
            case 12:
              return (s12 + s12).slice(0, 3);
            default:
              return s12 + s12;
          }
        }
        t6.parseColor = function(e4) {
          if (!e4)
            return;
          let t7 = e4.toLowerCase();
          if (0 === t7.indexOf("rgb:")) {
            t7 = t7.slice(4);
            const e5 = i8.exec(t7);
            if (e5) {
              const t8 = e5[1] ? 15 : e5[4] ? 255 : e5[7] ? 4095 : 65535;
              return [Math.round(parseInt(e5[1] || e5[4] || e5[7] || e5[10], 16) / t8 * 255), Math.round(parseInt(e5[2] || e5[5] || e5[8] || e5[11], 16) / t8 * 255), Math.round(parseInt(e5[3] || e5[6] || e5[9] || e5[12], 16) / t8 * 255)];
            }
          } else if (0 === t7.indexOf("#") && (t7 = t7.slice(1), s11.exec(t7) && [3, 6, 9, 12].includes(t7.length))) {
            const e5 = t7.length / 3, i9 = [0, 0, 0];
            for (let s12 = 0; s12 < 3; ++s12) {
              const r5 = parseInt(t7.slice(e5 * s12, e5 * s12 + e5), 16);
              i9[s12] = 1 === e5 ? r5 << 4 : 2 === e5 ? r5 : 3 === e5 ? r5 >> 4 : r5 >> 8;
            }
            return i9;
          }
        }, t6.toRgbString = function(e4, t7 = 16) {
          const [i9, s12, n8] = e4;
          return `rgb:${r4(i9, t7)}/${r4(s12, t7)}/${r4(n8, t7)}`;
        };
      }, 5770: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.PAYLOAD_LIMIT = void 0, t6.PAYLOAD_LIMIT = 1e7;
      }, 6351: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DcsHandler = t6.DcsParser = void 0;
        const s11 = i8(482), r4 = i8(8742), n8 = i8(5770), o5 = [];
        t6.DcsParser = class {
          constructor() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._active = o5, this._ident = 0, this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = o5;
          }
          registerHandler(e4, t7) {
            void 0 === this._handlers[e4] && (this._handlers[e4] = []);
            const i9 = this._handlers[e4];
            return i9.push(t7), { dispose: () => {
              const e5 = i9.indexOf(t7);
              -1 !== e5 && i9.splice(e5, 1);
            } };
          }
          clearHandler(e4) {
            this._handlers[e4] && delete this._handlers[e4];
          }
          setHandlerFallback(e4) {
            this._handlerFb = e4;
          }
          reset() {
            if (this._active.length)
              for (let e4 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e4 >= 0; --e4)
                this._active[e4].unhook(false);
            this._stack.paused = false, this._active = o5, this._ident = 0;
          }
          hook(e4, t7) {
            if (this.reset(), this._ident = e4, this._active = this._handlers[e4] || o5, this._active.length)
              for (let e5 = this._active.length - 1; e5 >= 0; e5--)
                this._active[e5].hook(t7);
            else
              this._handlerFb(this._ident, "HOOK", t7);
          }
          put(e4, t7, i9) {
            if (this._active.length)
              for (let s12 = this._active.length - 1; s12 >= 0; s12--)
                this._active[s12].put(e4, t7, i9);
            else
              this._handlerFb(this._ident, "PUT", (0, s11.utf32ToString)(e4, t7, i9));
          }
          unhook(e4, t7 = true) {
            if (this._active.length) {
              let i9 = false, s12 = this._active.length - 1, r5 = false;
              if (this._stack.paused && (s12 = this._stack.loopPosition - 1, i9 = t7, r5 = this._stack.fallThrough, this._stack.paused = false), !r5 && false === i9) {
                for (; s12 >= 0 && (i9 = this._active[s12].unhook(e4), true !== i9); s12--)
                  if (i9 instanceof Promise)
                    return this._stack.paused = true, this._stack.loopPosition = s12, this._stack.fallThrough = false, i9;
                s12--;
              }
              for (; s12 >= 0; s12--)
                if (i9 = this._active[s12].unhook(false), i9 instanceof Promise)
                  return this._stack.paused = true, this._stack.loopPosition = s12, this._stack.fallThrough = true, i9;
            } else
              this._handlerFb(this._ident, "UNHOOK", e4);
            this._active = o5, this._ident = 0;
          }
        };
        const a8 = new r4.Params();
        a8.addParam(0), t6.DcsHandler = class {
          constructor(e4) {
            this._handler = e4, this._data = "", this._params = a8, this._hitLimit = false;
          }
          hook(e4) {
            this._params = e4.length > 1 || e4.params[0] ? e4.clone() : a8, this._data = "", this._hitLimit = false;
          }
          put(e4, t7, i9) {
            this._hitLimit || (this._data += (0, s11.utf32ToString)(e4, t7, i9), this._data.length > n8.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          unhook(e4) {
            let t7 = false;
            if (this._hitLimit)
              t7 = false;
            else if (e4 && (t7 = this._handler(this._data, this._params), t7 instanceof Promise))
              return t7.then((e5) => (this._params = a8, this._data = "", this._hitLimit = false, e5));
            return this._params = a8, this._data = "", this._hitLimit = false, t7;
          }
        };
      }, 2015: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.EscapeSequenceParser = t6.VT500_TRANSITION_TABLE = t6.TransitionTable = void 0;
        const s11 = i8(844), r4 = i8(8742), n8 = i8(6242), o5 = i8(6351);
        class a8 {
          constructor(e4) {
            this.table = new Uint8Array(e4);
          }
          setDefault(e4, t7) {
            this.table.fill(e4 << 4 | t7);
          }
          add(e4, t7, i9, s12) {
            this.table[t7 << 8 | e4] = i9 << 4 | s12;
          }
          addMany(e4, t7, i9, s12) {
            for (let r5 = 0; r5 < e4.length; r5++)
              this.table[t7 << 8 | e4[r5]] = i9 << 4 | s12;
          }
        }
        t6.TransitionTable = a8;
        const h3 = 160;
        t6.VT500_TRANSITION_TABLE = function() {
          const e4 = new a8(4095), t7 = Array.apply(null, Array(256)).map((e5, t8) => t8), i9 = (e5, i10) => t7.slice(e5, i10), s12 = i9(32, 127), r5 = i9(0, 24);
          r5.push(25), r5.push.apply(r5, i9(28, 32));
          const n9 = i9(0, 14);
          let o6;
          for (o6 in e4.setDefault(1, 0), e4.addMany(s12, 0, 2, 0), n9)
            e4.addMany([24, 26, 153, 154], o6, 3, 0), e4.addMany(i9(128, 144), o6, 3, 0), e4.addMany(i9(144, 152), o6, 3, 0), e4.add(156, o6, 0, 0), e4.add(27, o6, 11, 1), e4.add(157, o6, 4, 8), e4.addMany([152, 158, 159], o6, 0, 7), e4.add(155, o6, 11, 3), e4.add(144, o6, 11, 9);
          return e4.addMany(r5, 0, 3, 0), e4.addMany(r5, 1, 3, 1), e4.add(127, 1, 0, 1), e4.addMany(r5, 8, 0, 8), e4.addMany(r5, 3, 3, 3), e4.add(127, 3, 0, 3), e4.addMany(r5, 4, 3, 4), e4.add(127, 4, 0, 4), e4.addMany(r5, 6, 3, 6), e4.addMany(r5, 5, 3, 5), e4.add(127, 5, 0, 5), e4.addMany(r5, 2, 3, 2), e4.add(127, 2, 0, 2), e4.add(93, 1, 4, 8), e4.addMany(s12, 8, 5, 8), e4.add(127, 8, 5, 8), e4.addMany([156, 27, 24, 26, 7], 8, 6, 0), e4.addMany(i9(28, 32), 8, 0, 8), e4.addMany([88, 94, 95], 1, 0, 7), e4.addMany(s12, 7, 0, 7), e4.addMany(r5, 7, 0, 7), e4.add(156, 7, 0, 0), e4.add(127, 7, 0, 7), e4.add(91, 1, 11, 3), e4.addMany(i9(64, 127), 3, 7, 0), e4.addMany(i9(48, 60), 3, 8, 4), e4.addMany([60, 61, 62, 63], 3, 9, 4), e4.addMany(i9(48, 60), 4, 8, 4), e4.addMany(i9(64, 127), 4, 7, 0), e4.addMany([60, 61, 62, 63], 4, 0, 6), e4.addMany(i9(32, 64), 6, 0, 6), e4.add(127, 6, 0, 6), e4.addMany(i9(64, 127), 6, 0, 0), e4.addMany(i9(32, 48), 3, 9, 5), e4.addMany(i9(32, 48), 5, 9, 5), e4.addMany(i9(48, 64), 5, 0, 6), e4.addMany(i9(64, 127), 5, 7, 0), e4.addMany(i9(32, 48), 4, 9, 5), e4.addMany(i9(32, 48), 1, 9, 2), e4.addMany(i9(32, 48), 2, 9, 2), e4.addMany(i9(48, 127), 2, 10, 0), e4.addMany(i9(48, 80), 1, 10, 0), e4.addMany(i9(81, 88), 1, 10, 0), e4.addMany([89, 90, 92], 1, 10, 0), e4.addMany(i9(96, 127), 1, 10, 0), e4.add(80, 1, 11, 9), e4.addMany(r5, 9, 0, 9), e4.add(127, 9, 0, 9), e4.addMany(i9(28, 32), 9, 0, 9), e4.addMany(i9(32, 48), 9, 9, 12), e4.addMany(i9(48, 60), 9, 8, 10), e4.addMany([60, 61, 62, 63], 9, 9, 10), e4.addMany(r5, 11, 0, 11), e4.addMany(i9(32, 128), 11, 0, 11), e4.addMany(i9(28, 32), 11, 0, 11), e4.addMany(r5, 10, 0, 10), e4.add(127, 10, 0, 10), e4.addMany(i9(28, 32), 10, 0, 10), e4.addMany(i9(48, 60), 10, 8, 10), e4.addMany([60, 61, 62, 63], 10, 0, 11), e4.addMany(i9(32, 48), 10, 9, 12), e4.addMany(r5, 12, 0, 12), e4.add(127, 12, 0, 12), e4.addMany(i9(28, 32), 12, 0, 12), e4.addMany(i9(32, 48), 12, 9, 12), e4.addMany(i9(48, 64), 12, 0, 11), e4.addMany(i9(64, 127), 12, 12, 13), e4.addMany(i9(64, 127), 10, 12, 13), e4.addMany(i9(64, 127), 9, 12, 13), e4.addMany(r5, 13, 13, 13), e4.addMany(s12, 13, 13, 13), e4.add(127, 13, 0, 13), e4.addMany([27, 156, 24, 26], 13, 14, 0), e4.add(h3, 0, 2, 0), e4.add(h3, 8, 5, 8), e4.add(h3, 6, 0, 6), e4.add(h3, 11, 0, 11), e4.add(h3, 13, 13, 13), e4;
        }();
        class c12 extends s11.Disposable {
          constructor(e4 = t6.VT500_TRANSITION_TABLE) {
            super(), this._transitions = e4, this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 }, this.initialState = 0, this.currentState = this.initialState, this._params = new r4.Params(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0, this._printHandlerFb = (e5, t7, i9) => {
            }, this._executeHandlerFb = (e5) => {
            }, this._csiHandlerFb = (e5, t7) => {
            }, this._escHandlerFb = (e5) => {
            }, this._errorHandlerFb = (e5) => e5, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this.register((0, s11.toDisposable)(() => {
              this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
            })), this._oscParser = this.register(new n8.OscParser()), this._dcsParser = this.register(new o5.DcsParser()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, () => true);
          }
          _identifier(e4, t7 = [64, 126]) {
            let i9 = 0;
            if (e4.prefix) {
              if (e4.prefix.length > 1)
                throw new Error("only one byte as prefix supported");
              if (i9 = e4.prefix.charCodeAt(0), i9 && 60 > i9 || i9 > 63)
                throw new Error("prefix must be in range 0x3c .. 0x3f");
            }
            if (e4.intermediates) {
              if (e4.intermediates.length > 2)
                throw new Error("only two bytes as intermediates are supported");
              for (let t8 = 0; t8 < e4.intermediates.length; ++t8) {
                const s13 = e4.intermediates.charCodeAt(t8);
                if (32 > s13 || s13 > 47)
                  throw new Error("intermediate must be in range 0x20 .. 0x2f");
                i9 <<= 8, i9 |= s13;
              }
            }
            if (1 !== e4.final.length)
              throw new Error("final must be a single byte");
            const s12 = e4.final.charCodeAt(0);
            if (t7[0] > s12 || s12 > t7[1])
              throw new Error(`final must be in range ${t7[0]} .. ${t7[1]}`);
            return i9 <<= 8, i9 |= s12, i9;
          }
          identToString(e4) {
            const t7 = [];
            for (; e4; )
              t7.push(String.fromCharCode(255 & e4)), e4 >>= 8;
            return t7.reverse().join("");
          }
          setPrintHandler(e4) {
            this._printHandler = e4;
          }
          clearPrintHandler() {
            this._printHandler = this._printHandlerFb;
          }
          registerEscHandler(e4, t7) {
            const i9 = this._identifier(e4, [48, 126]);
            void 0 === this._escHandlers[i9] && (this._escHandlers[i9] = []);
            const s12 = this._escHandlers[i9];
            return s12.push(t7), { dispose: () => {
              const e5 = s12.indexOf(t7);
              -1 !== e5 && s12.splice(e5, 1);
            } };
          }
          clearEscHandler(e4) {
            this._escHandlers[this._identifier(e4, [48, 126])] && delete this._escHandlers[this._identifier(e4, [48, 126])];
          }
          setEscHandlerFallback(e4) {
            this._escHandlerFb = e4;
          }
          setExecuteHandler(e4, t7) {
            this._executeHandlers[e4.charCodeAt(0)] = t7;
          }
          clearExecuteHandler(e4) {
            this._executeHandlers[e4.charCodeAt(0)] && delete this._executeHandlers[e4.charCodeAt(0)];
          }
          setExecuteHandlerFallback(e4) {
            this._executeHandlerFb = e4;
          }
          registerCsiHandler(e4, t7) {
            const i9 = this._identifier(e4);
            void 0 === this._csiHandlers[i9] && (this._csiHandlers[i9] = []);
            const s12 = this._csiHandlers[i9];
            return s12.push(t7), { dispose: () => {
              const e5 = s12.indexOf(t7);
              -1 !== e5 && s12.splice(e5, 1);
            } };
          }
          clearCsiHandler(e4) {
            this._csiHandlers[this._identifier(e4)] && delete this._csiHandlers[this._identifier(e4)];
          }
          setCsiHandlerFallback(e4) {
            this._csiHandlerFb = e4;
          }
          registerDcsHandler(e4, t7) {
            return this._dcsParser.registerHandler(this._identifier(e4), t7);
          }
          clearDcsHandler(e4) {
            this._dcsParser.clearHandler(this._identifier(e4));
          }
          setDcsHandlerFallback(e4) {
            this._dcsParser.setHandlerFallback(e4);
          }
          registerOscHandler(e4, t7) {
            return this._oscParser.registerHandler(e4, t7);
          }
          clearOscHandler(e4) {
            this._oscParser.clearHandler(e4);
          }
          setOscHandlerFallback(e4) {
            this._oscParser.setHandlerFallback(e4);
          }
          setErrorHandler(e4) {
            this._errorHandler = e4;
          }
          clearErrorHandler() {
            this._errorHandler = this._errorHandlerFb;
          }
          reset() {
            this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0, 0 !== this._parseStack.state && (this._parseStack.state = 2, this._parseStack.handlers = []);
          }
          _preserveStack(e4, t7, i9, s12, r5) {
            this._parseStack.state = e4, this._parseStack.handlers = t7, this._parseStack.handlerPos = i9, this._parseStack.transition = s12, this._parseStack.chunkPos = r5;
          }
          parse(e4, t7, i9) {
            let s12, r5 = 0, n9 = 0, o6 = 0;
            if (this._parseStack.state)
              if (2 === this._parseStack.state)
                this._parseStack.state = 0, o6 = this._parseStack.chunkPos + 1;
              else {
                if (void 0 === i9 || 1 === this._parseStack.state)
                  throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
                const t8 = this._parseStack.handlers;
                let n10 = this._parseStack.handlerPos - 1;
                switch (this._parseStack.state) {
                  case 3:
                    if (false === i9 && n10 > -1) {
                      for (; n10 >= 0 && (s12 = t8[n10](this._params), true !== s12); n10--)
                        if (s12 instanceof Promise)
                          return this._parseStack.handlerPos = n10, s12;
                    }
                    this._parseStack.handlers = [];
                    break;
                  case 4:
                    if (false === i9 && n10 > -1) {
                      for (; n10 >= 0 && (s12 = t8[n10](), true !== s12); n10--)
                        if (s12 instanceof Promise)
                          return this._parseStack.handlerPos = n10, s12;
                    }
                    this._parseStack.handlers = [];
                    break;
                  case 6:
                    if (r5 = e4[this._parseStack.chunkPos], s12 = this._dcsParser.unhook(24 !== r5 && 26 !== r5, i9), s12)
                      return s12;
                    27 === r5 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
                    break;
                  case 5:
                    if (r5 = e4[this._parseStack.chunkPos], s12 = this._oscParser.end(24 !== r5 && 26 !== r5, i9), s12)
                      return s12;
                    27 === r5 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
                }
                this._parseStack.state = 0, o6 = this._parseStack.chunkPos + 1, this.precedingCodepoint = 0, this.currentState = 15 & this._parseStack.transition;
              }
            for (let i10 = o6; i10 < t7; ++i10) {
              switch (r5 = e4[i10], n9 = this._transitions.table[this.currentState << 8 | (r5 < 160 ? r5 : h3)], n9 >> 4) {
                case 2:
                  for (let s13 = i10 + 1; ; ++s13) {
                    if (s13 >= t7 || (r5 = e4[s13]) < 32 || r5 > 126 && r5 < h3) {
                      this._printHandler(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                    if (++s13 >= t7 || (r5 = e4[s13]) < 32 || r5 > 126 && r5 < h3) {
                      this._printHandler(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                    if (++s13 >= t7 || (r5 = e4[s13]) < 32 || r5 > 126 && r5 < h3) {
                      this._printHandler(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                    if (++s13 >= t7 || (r5 = e4[s13]) < 32 || r5 > 126 && r5 < h3) {
                      this._printHandler(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                  }
                  break;
                case 3:
                  this._executeHandlers[r5] ? this._executeHandlers[r5]() : this._executeHandlerFb(r5), this.precedingCodepoint = 0;
                  break;
                case 0:
                  break;
                case 1:
                  if (this._errorHandler({ position: i10, code: r5, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort)
                    return;
                  break;
                case 7:
                  const o7 = this._csiHandlers[this._collect << 8 | r5];
                  let a9 = o7 ? o7.length - 1 : -1;
                  for (; a9 >= 0 && (s12 = o7[a9](this._params), true !== s12); a9--)
                    if (s12 instanceof Promise)
                      return this._preserveStack(3, o7, a9, n9, i10), s12;
                  a9 < 0 && this._csiHandlerFb(this._collect << 8 | r5, this._params), this.precedingCodepoint = 0;
                  break;
                case 8:
                  do {
                    switch (r5) {
                      case 59:
                        this._params.addParam(0);
                        break;
                      case 58:
                        this._params.addSubParam(-1);
                        break;
                      default:
                        this._params.addDigit(r5 - 48);
                    }
                  } while (++i10 < t7 && (r5 = e4[i10]) > 47 && r5 < 60);
                  i10--;
                  break;
                case 9:
                  this._collect <<= 8, this._collect |= r5;
                  break;
                case 10:
                  const c13 = this._escHandlers[this._collect << 8 | r5];
                  let l9 = c13 ? c13.length - 1 : -1;
                  for (; l9 >= 0 && (s12 = c13[l9](), true !== s12); l9--)
                    if (s12 instanceof Promise)
                      return this._preserveStack(4, c13, l9, n9, i10), s12;
                  l9 < 0 && this._escHandlerFb(this._collect << 8 | r5), this.precedingCodepoint = 0;
                  break;
                case 11:
                  this._params.reset(), this._params.addParam(0), this._collect = 0;
                  break;
                case 12:
                  this._dcsParser.hook(this._collect << 8 | r5, this._params);
                  break;
                case 13:
                  for (let s13 = i10 + 1; ; ++s13)
                    if (s13 >= t7 || 24 === (r5 = e4[s13]) || 26 === r5 || 27 === r5 || r5 > 127 && r5 < h3) {
                      this._dcsParser.put(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                  break;
                case 14:
                  if (s12 = this._dcsParser.unhook(24 !== r5 && 26 !== r5), s12)
                    return this._preserveStack(6, [], 0, n9, i10), s12;
                  27 === r5 && (n9 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0;
                  break;
                case 4:
                  this._oscParser.start();
                  break;
                case 5:
                  for (let s13 = i10 + 1; ; s13++)
                    if (s13 >= t7 || (r5 = e4[s13]) < 32 || r5 > 127 && r5 < h3) {
                      this._oscParser.put(e4, i10, s13), i10 = s13 - 1;
                      break;
                    }
                  break;
                case 6:
                  if (s12 = this._oscParser.end(24 !== r5 && 26 !== r5), s12)
                    return this._preserveStack(5, [], 0, n9, i10), s12;
                  27 === r5 && (n9 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0;
              }
              this.currentState = 15 & n9;
            }
          }
        }
        t6.EscapeSequenceParser = c12;
      }, 6242: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.OscHandler = t6.OscParser = void 0;
        const s11 = i8(5770), r4 = i8(482), n8 = [];
        t6.OscParser = class {
          constructor() {
            this._state = 0, this._active = n8, this._id = -1, this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          registerHandler(e4, t7) {
            void 0 === this._handlers[e4] && (this._handlers[e4] = []);
            const i9 = this._handlers[e4];
            return i9.push(t7), { dispose: () => {
              const e5 = i9.indexOf(t7);
              -1 !== e5 && i9.splice(e5, 1);
            } };
          }
          clearHandler(e4) {
            this._handlers[e4] && delete this._handlers[e4];
          }
          setHandlerFallback(e4) {
            this._handlerFb = e4;
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = n8;
          }
          reset() {
            if (2 === this._state)
              for (let e4 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e4 >= 0; --e4)
                this._active[e4].end(false);
            this._stack.paused = false, this._active = n8, this._id = -1, this._state = 0;
          }
          _start() {
            if (this._active = this._handlers[this._id] || n8, this._active.length)
              for (let e4 = this._active.length - 1; e4 >= 0; e4--)
                this._active[e4].start();
            else
              this._handlerFb(this._id, "START");
          }
          _put(e4, t7, i9) {
            if (this._active.length)
              for (let s12 = this._active.length - 1; s12 >= 0; s12--)
                this._active[s12].put(e4, t7, i9);
            else
              this._handlerFb(this._id, "PUT", (0, r4.utf32ToString)(e4, t7, i9));
          }
          start() {
            this.reset(), this._state = 1;
          }
          put(e4, t7, i9) {
            if (3 !== this._state) {
              if (1 === this._state)
                for (; t7 < i9; ) {
                  const i10 = e4[t7++];
                  if (59 === i10) {
                    this._state = 2, this._start();
                    break;
                  }
                  if (i10 < 48 || 57 < i10)
                    return void (this._state = 3);
                  -1 === this._id && (this._id = 0), this._id = 10 * this._id + i10 - 48;
                }
              2 === this._state && i9 - t7 > 0 && this._put(e4, t7, i9);
            }
          }
          end(e4, t7 = true) {
            if (0 !== this._state) {
              if (3 !== this._state)
                if (1 === this._state && this._start(), this._active.length) {
                  let i9 = false, s12 = this._active.length - 1, r5 = false;
                  if (this._stack.paused && (s12 = this._stack.loopPosition - 1, i9 = t7, r5 = this._stack.fallThrough, this._stack.paused = false), !r5 && false === i9) {
                    for (; s12 >= 0 && (i9 = this._active[s12].end(e4), true !== i9); s12--)
                      if (i9 instanceof Promise)
                        return this._stack.paused = true, this._stack.loopPosition = s12, this._stack.fallThrough = false, i9;
                    s12--;
                  }
                  for (; s12 >= 0; s12--)
                    if (i9 = this._active[s12].end(false), i9 instanceof Promise)
                      return this._stack.paused = true, this._stack.loopPosition = s12, this._stack.fallThrough = true, i9;
                } else
                  this._handlerFb(this._id, "END", e4);
              this._active = n8, this._id = -1, this._state = 0;
            }
          }
        }, t6.OscHandler = class {
          constructor(e4) {
            this._handler = e4, this._data = "", this._hitLimit = false;
          }
          start() {
            this._data = "", this._hitLimit = false;
          }
          put(e4, t7, i9) {
            this._hitLimit || (this._data += (0, r4.utf32ToString)(e4, t7, i9), this._data.length > s11.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          end(e4) {
            let t7 = false;
            if (this._hitLimit)
              t7 = false;
            else if (e4 && (t7 = this._handler(this._data), t7 instanceof Promise))
              return t7.then((e5) => (this._data = "", this._hitLimit = false, e5));
            return this._data = "", this._hitLimit = false, t7;
          }
        };
      }, 8742: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.Params = void 0;
        const i8 = 2147483647;
        class s11 {
          static fromArray(e4) {
            const t7 = new s11();
            if (!e4.length)
              return t7;
            for (let i9 = Array.isArray(e4[0]) ? 1 : 0; i9 < e4.length; ++i9) {
              const s12 = e4[i9];
              if (Array.isArray(s12))
                for (let e5 = 0; e5 < s12.length; ++e5)
                  t7.addSubParam(s12[e5]);
              else
                t7.addParam(s12);
            }
            return t7;
          }
          constructor(e4 = 32, t7 = 32) {
            if (this.maxLength = e4, this.maxSubParamsLength = t7, t7 > 256)
              throw new Error("maxSubParamsLength must not be greater than 256");
            this.params = new Int32Array(e4), this.length = 0, this._subParams = new Int32Array(t7), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(e4), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          clone() {
            const e4 = new s11(this.maxLength, this.maxSubParamsLength);
            return e4.params.set(this.params), e4.length = this.length, e4._subParams.set(this._subParams), e4._subParamsLength = this._subParamsLength, e4._subParamsIdx.set(this._subParamsIdx), e4._rejectDigits = this._rejectDigits, e4._rejectSubDigits = this._rejectSubDigits, e4._digitIsSub = this._digitIsSub, e4;
          }
          toArray() {
            const e4 = [];
            for (let t7 = 0; t7 < this.length; ++t7) {
              e4.push(this.params[t7]);
              const i9 = this._subParamsIdx[t7] >> 8, s12 = 255 & this._subParamsIdx[t7];
              s12 - i9 > 0 && e4.push(Array.prototype.slice.call(this._subParams, i9, s12));
            }
            return e4;
          }
          reset() {
            this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          addParam(e4) {
            if (this._digitIsSub = false, this.length >= this.maxLength)
              this._rejectDigits = true;
            else {
              if (e4 < -1)
                throw new Error("values lesser than -1 are not allowed");
              this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = e4 > i8 ? i8 : e4;
            }
          }
          addSubParam(e4) {
            if (this._digitIsSub = true, this.length)
              if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength)
                this._rejectSubDigits = true;
              else {
                if (e4 < -1)
                  throw new Error("values lesser than -1 are not allowed");
                this._subParams[this._subParamsLength++] = e4 > i8 ? i8 : e4, this._subParamsIdx[this.length - 1]++;
              }
          }
          hasSubParams(e4) {
            return (255 & this._subParamsIdx[e4]) - (this._subParamsIdx[e4] >> 8) > 0;
          }
          getSubParams(e4) {
            const t7 = this._subParamsIdx[e4] >> 8, i9 = 255 & this._subParamsIdx[e4];
            return i9 - t7 > 0 ? this._subParams.subarray(t7, i9) : null;
          }
          getSubParamsAll() {
            const e4 = {};
            for (let t7 = 0; t7 < this.length; ++t7) {
              const i9 = this._subParamsIdx[t7] >> 8, s12 = 255 & this._subParamsIdx[t7];
              s12 - i9 > 0 && (e4[t7] = this._subParams.slice(i9, s12));
            }
            return e4;
          }
          addDigit(e4) {
            let t7;
            if (this._rejectDigits || !(t7 = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits)
              return;
            const s12 = this._digitIsSub ? this._subParams : this.params, r4 = s12[t7 - 1];
            s12[t7 - 1] = ~r4 ? Math.min(10 * r4 + e4, i8) : e4;
          }
        }
        t6.Params = s11;
      }, 5741: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.AddonManager = void 0, t6.AddonManager = class {
          constructor() {
            this._addons = [];
          }
          dispose() {
            for (let e4 = this._addons.length - 1; e4 >= 0; e4--)
              this._addons[e4].instance.dispose();
          }
          loadAddon(e4, t7) {
            const i8 = { instance: t7, dispose: t7.dispose, isDisposed: false };
            this._addons.push(i8), t7.dispose = () => this._wrappedAddonDispose(i8), t7.activate(e4);
          }
          _wrappedAddonDispose(e4) {
            if (e4.isDisposed)
              return;
            let t7 = -1;
            for (let i8 = 0; i8 < this._addons.length; i8++)
              if (this._addons[i8] === e4) {
                t7 = i8;
                break;
              }
            if (-1 === t7)
              throw new Error("Could not dispose an addon that has not been loaded");
            e4.isDisposed = true, e4.dispose.apply(e4.instance), this._addons.splice(t7, 1);
          }
        };
      }, 8771: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferApiView = void 0;
        const s11 = i8(3785), r4 = i8(511);
        t6.BufferApiView = class {
          constructor(e4, t7) {
            this._buffer = e4, this.type = t7;
          }
          init(e4) {
            return this._buffer = e4, this;
          }
          get cursorY() {
            return this._buffer.y;
          }
          get cursorX() {
            return this._buffer.x;
          }
          get viewportY() {
            return this._buffer.ydisp;
          }
          get baseY() {
            return this._buffer.ybase;
          }
          get length() {
            return this._buffer.lines.length;
          }
          getLine(e4) {
            const t7 = this._buffer.lines.get(e4);
            if (t7)
              return new s11.BufferLineApiView(t7);
          }
          getNullCell() {
            return new r4.CellData();
          }
        };
      }, 3785: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferLineApiView = void 0;
        const s11 = i8(511);
        t6.BufferLineApiView = class {
          constructor(e4) {
            this._line = e4;
          }
          get isWrapped() {
            return this._line.isWrapped;
          }
          get length() {
            return this._line.length;
          }
          getCell(e4, t7) {
            if (!(e4 < 0 || e4 >= this._line.length))
              return t7 ? (this._line.loadCell(e4, t7), t7) : this._line.loadCell(e4, new s11.CellData());
          }
          translateToString(e4, t7, i9) {
            return this._line.translateToString(e4, t7, i9);
          }
        };
      }, 8285: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferNamespaceApi = void 0;
        const s11 = i8(8771), r4 = i8(8460), n8 = i8(844);
        class o5 extends n8.Disposable {
          constructor(e4) {
            super(), this._core = e4, this._onBufferChange = this.register(new r4.EventEmitter()), this.onBufferChange = this._onBufferChange.event, this._normal = new s11.BufferApiView(this._core.buffers.normal, "normal"), this._alternate = new s11.BufferApiView(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate(() => this._onBufferChange.fire(this.active));
          }
          get active() {
            if (this._core.buffers.active === this._core.buffers.normal)
              return this.normal;
            if (this._core.buffers.active === this._core.buffers.alt)
              return this.alternate;
            throw new Error("Active buffer is neither normal nor alternate");
          }
          get normal() {
            return this._normal.init(this._core.buffers.normal);
          }
          get alternate() {
            return this._alternate.init(this._core.buffers.alt);
          }
        }
        t6.BufferNamespaceApi = o5;
      }, 7975: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.ParserApi = void 0, t6.ParserApi = class {
          constructor(e4) {
            this._core = e4;
          }
          registerCsiHandler(e4, t7) {
            return this._core.registerCsiHandler(e4, (e5) => t7(e5.toArray()));
          }
          addCsiHandler(e4, t7) {
            return this.registerCsiHandler(e4, t7);
          }
          registerDcsHandler(e4, t7) {
            return this._core.registerDcsHandler(e4, (e5, i8) => t7(e5, i8.toArray()));
          }
          addDcsHandler(e4, t7) {
            return this.registerDcsHandler(e4, t7);
          }
          registerEscHandler(e4, t7) {
            return this._core.registerEscHandler(e4, t7);
          }
          addEscHandler(e4, t7) {
            return this.registerEscHandler(e4, t7);
          }
          registerOscHandler(e4, t7) {
            return this._core.registerOscHandler(e4, t7);
          }
          addOscHandler(e4, t7) {
            return this.registerOscHandler(e4, t7);
          }
        };
      }, 7090: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.UnicodeApi = void 0, t6.UnicodeApi = class {
          constructor(e4) {
            this._core = e4;
          }
          register(e4) {
            this._core.unicodeService.register(e4);
          }
          get versions() {
            return this._core.unicodeService.versions;
          }
          get activeVersion() {
            return this._core.unicodeService.activeVersion;
          }
          set activeVersion(e4) {
            this._core.unicodeService.activeVersion = e4;
          }
        };
      }, 744: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.BufferService = t6.MINIMUM_ROWS = t6.MINIMUM_COLS = void 0;
        const n8 = i8(8460), o5 = i8(844), a8 = i8(5295), h3 = i8(2585);
        t6.MINIMUM_COLS = 2, t6.MINIMUM_ROWS = 1;
        let c12 = t6.BufferService = class extends o5.Disposable {
          get buffer() {
            return this.buffers.active;
          }
          constructor(e4) {
            super(), this.isUserScrolling = false, this._onResize = this.register(new n8.EventEmitter()), this.onResize = this._onResize.event, this._onScroll = this.register(new n8.EventEmitter()), this.onScroll = this._onScroll.event, this.cols = Math.max(e4.rawOptions.cols || 0, t6.MINIMUM_COLS), this.rows = Math.max(e4.rawOptions.rows || 0, t6.MINIMUM_ROWS), this.buffers = this.register(new a8.BufferSet(e4, this));
          }
          resize(e4, t7) {
            this.cols = e4, this.rows = t7, this.buffers.resize(e4, t7), this._onResize.fire({ cols: e4, rows: t7 });
          }
          reset() {
            this.buffers.reset(), this.isUserScrolling = false;
          }
          scroll(e4, t7 = false) {
            const i9 = this.buffer;
            let s12;
            s12 = this._cachedBlankLine, s12 && s12.length === this.cols && s12.getFg(0) === e4.fg && s12.getBg(0) === e4.bg || (s12 = i9.getBlankLine(e4, t7), this._cachedBlankLine = s12), s12.isWrapped = t7;
            const r5 = i9.ybase + i9.scrollTop, n9 = i9.ybase + i9.scrollBottom;
            if (0 === i9.scrollTop) {
              const e5 = i9.lines.isFull;
              n9 === i9.lines.length - 1 ? e5 ? i9.lines.recycle().copyFrom(s12) : i9.lines.push(s12.clone()) : i9.lines.splice(n9 + 1, 0, s12.clone()), e5 ? this.isUserScrolling && (i9.ydisp = Math.max(i9.ydisp - 1, 0)) : (i9.ybase++, this.isUserScrolling || i9.ydisp++);
            } else {
              const e5 = n9 - r5 + 1;
              i9.lines.shiftElements(r5 + 1, e5 - 1, -1), i9.lines.set(n9, s12.clone());
            }
            this.isUserScrolling || (i9.ydisp = i9.ybase), this._onScroll.fire(i9.ydisp);
          }
          scrollLines(e4, t7, i9) {
            const s12 = this.buffer;
            if (e4 < 0) {
              if (0 === s12.ydisp)
                return;
              this.isUserScrolling = true;
            } else
              e4 + s12.ydisp >= s12.ybase && (this.isUserScrolling = false);
            const r5 = s12.ydisp;
            s12.ydisp = Math.max(Math.min(s12.ydisp + e4, s12.ybase), 0), r5 !== s12.ydisp && (t7 || this._onScroll.fire(s12.ydisp));
          }
        };
        t6.BufferService = c12 = s11([r4(0, h3.IOptionsService)], c12);
      }, 7994: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CharsetService = void 0, t6.CharsetService = class {
          constructor() {
            this.glevel = 0, this._charsets = [];
          }
          reset() {
            this.charset = void 0, this._charsets = [], this.glevel = 0;
          }
          setgLevel(e4) {
            this.glevel = e4, this.charset = this._charsets[e4];
          }
          setgCharset(e4, t7) {
            this._charsets[e4] = t7, this.glevel === e4 && (this.charset = t7);
          }
        };
      }, 1753: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CoreMouseService = void 0;
        const n8 = i8(2585), o5 = i8(8460), a8 = i8(844), h3 = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (e4) => 4 !== e4.button && 1 === e4.action && (e4.ctrl = false, e4.alt = false, e4.shift = false, true) }, VT200: { events: 19, restrict: (e4) => 32 !== e4.action }, DRAG: { events: 23, restrict: (e4) => 32 !== e4.action || 3 !== e4.button }, ANY: { events: 31, restrict: (e4) => true } };
        function c12(e4, t7) {
          let i9 = (e4.ctrl ? 16 : 0) | (e4.shift ? 4 : 0) | (e4.alt ? 8 : 0);
          return 4 === e4.button ? (i9 |= 64, i9 |= e4.action) : (i9 |= 3 & e4.button, 4 & e4.button && (i9 |= 64), 8 & e4.button && (i9 |= 128), 32 === e4.action ? i9 |= 32 : 0 !== e4.action || t7 || (i9 |= 3)), i9;
        }
        const l9 = String.fromCharCode, d7 = { DEFAULT: (e4) => {
          const t7 = [c12(e4, false) + 32, e4.col + 32, e4.row + 32];
          return t7[0] > 255 || t7[1] > 255 || t7[2] > 255 ? "" : `\x1B[M${l9(t7[0])}${l9(t7[1])}${l9(t7[2])}`;
        }, SGR: (e4) => {
          const t7 = 0 === e4.action && 4 !== e4.button ? "m" : "M";
          return `\x1B[<${c12(e4, true)};${e4.col};${e4.row}${t7}`;
        }, SGR_PIXELS: (e4) => {
          const t7 = 0 === e4.action && 4 !== e4.button ? "m" : "M";
          return `\x1B[<${c12(e4, true)};${e4.x};${e4.y}${t7}`;
        } };
        let _4 = t6.CoreMouseService = class extends a8.Disposable {
          constructor(e4, t7) {
            super(), this._bufferService = e4, this._coreService = t7, this._protocols = {}, this._encodings = {}, this._activeProtocol = "", this._activeEncoding = "", this._lastEvent = null, this._onProtocolChange = this.register(new o5.EventEmitter()), this.onProtocolChange = this._onProtocolChange.event;
            for (const e5 of Object.keys(h3))
              this.addProtocol(e5, h3[e5]);
            for (const e5 of Object.keys(d7))
              this.addEncoding(e5, d7[e5]);
            this.reset();
          }
          addProtocol(e4, t7) {
            this._protocols[e4] = t7;
          }
          addEncoding(e4, t7) {
            this._encodings[e4] = t7;
          }
          get activeProtocol() {
            return this._activeProtocol;
          }
          get areMouseEventsActive() {
            return 0 !== this._protocols[this._activeProtocol].events;
          }
          set activeProtocol(e4) {
            if (!this._protocols[e4])
              throw new Error(`unknown protocol "${e4}"`);
            this._activeProtocol = e4, this._onProtocolChange.fire(this._protocols[e4].events);
          }
          get activeEncoding() {
            return this._activeEncoding;
          }
          set activeEncoding(e4) {
            if (!this._encodings[e4])
              throw new Error(`unknown encoding "${e4}"`);
            this._activeEncoding = e4;
          }
          reset() {
            this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null;
          }
          triggerMouseEvent(e4) {
            if (e4.col < 0 || e4.col >= this._bufferService.cols || e4.row < 0 || e4.row >= this._bufferService.rows)
              return false;
            if (4 === e4.button && 32 === e4.action)
              return false;
            if (3 === e4.button && 32 !== e4.action)
              return false;
            if (4 !== e4.button && (2 === e4.action || 3 === e4.action))
              return false;
            if (e4.col++, e4.row++, 32 === e4.action && this._lastEvent && this._equalEvents(this._lastEvent, e4, "SGR_PIXELS" === this._activeEncoding))
              return false;
            if (!this._protocols[this._activeProtocol].restrict(e4))
              return false;
            const t7 = this._encodings[this._activeEncoding](e4);
            return t7 && ("DEFAULT" === this._activeEncoding ? this._coreService.triggerBinaryEvent(t7) : this._coreService.triggerDataEvent(t7, true)), this._lastEvent = e4, true;
          }
          explainEvents(e4) {
            return { down: !!(1 & e4), up: !!(2 & e4), drag: !!(4 & e4), move: !!(8 & e4), wheel: !!(16 & e4) };
          }
          _equalEvents(e4, t7, i9) {
            if (i9) {
              if (e4.x !== t7.x)
                return false;
              if (e4.y !== t7.y)
                return false;
            } else {
              if (e4.col !== t7.col)
                return false;
              if (e4.row !== t7.row)
                return false;
            }
            return e4.button === t7.button && e4.action === t7.action && e4.ctrl === t7.ctrl && e4.alt === t7.alt && e4.shift === t7.shift;
          }
        };
        t6.CoreMouseService = _4 = s11([r4(0, n8.IBufferService), r4(1, n8.ICoreService)], _4);
      }, 6975: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.CoreService = void 0;
        const n8 = i8(1439), o5 = i8(8460), a8 = i8(844), h3 = i8(2585), c12 = Object.freeze({ insertMode: false }), l9 = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, origin: false, reverseWraparound: false, sendFocus: false, wraparound: true });
        let d7 = t6.CoreService = class extends a8.Disposable {
          constructor(e4, t7, i9) {
            super(), this._bufferService = e4, this._logService = t7, this._optionsService = i9, this.isCursorInitialized = false, this.isCursorHidden = false, this._onData = this.register(new o5.EventEmitter()), this.onData = this._onData.event, this._onUserInput = this.register(new o5.EventEmitter()), this.onUserInput = this._onUserInput.event, this._onBinary = this.register(new o5.EventEmitter()), this.onBinary = this._onBinary.event, this._onRequestScrollToBottom = this.register(new o5.EventEmitter()), this.onRequestScrollToBottom = this._onRequestScrollToBottom.event, this.modes = (0, n8.clone)(c12), this.decPrivateModes = (0, n8.clone)(l9);
          }
          reset() {
            this.modes = (0, n8.clone)(c12), this.decPrivateModes = (0, n8.clone)(l9);
          }
          triggerDataEvent(e4, t7 = false) {
            if (this._optionsService.rawOptions.disableStdin)
              return;
            const i9 = this._bufferService.buffer;
            t7 && this._optionsService.rawOptions.scrollOnUserInput && i9.ybase !== i9.ydisp && this._onRequestScrollToBottom.fire(), t7 && this._onUserInput.fire(), this._logService.debug(`sending data "${e4}"`, () => e4.split("").map((e5) => e5.charCodeAt(0))), this._onData.fire(e4);
          }
          triggerBinaryEvent(e4) {
            this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e4}"`, () => e4.split("").map((e5) => e5.charCodeAt(0))), this._onBinary.fire(e4));
          }
        };
        t6.CoreService = d7 = s11([r4(0, h3.IBufferService), r4(1, h3.ILogService), r4(2, h3.IOptionsService)], d7);
      }, 9074: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.DecorationService = void 0;
        const s11 = i8(8055), r4 = i8(8460), n8 = i8(844), o5 = i8(6106);
        let a8 = 0, h3 = 0;
        class c12 extends n8.Disposable {
          get decorations() {
            return this._decorations.values();
          }
          constructor() {
            super(), this._decorations = new o5.SortedList((e4) => null == e4 ? void 0 : e4.marker.line), this._onDecorationRegistered = this.register(new r4.EventEmitter()), this.onDecorationRegistered = this._onDecorationRegistered.event, this._onDecorationRemoved = this.register(new r4.EventEmitter()), this.onDecorationRemoved = this._onDecorationRemoved.event, this.register((0, n8.toDisposable)(() => this.reset()));
          }
          registerDecoration(e4) {
            if (e4.marker.isDisposed)
              return;
            const t7 = new l9(e4);
            if (t7) {
              const e5 = t7.marker.onDispose(() => t7.dispose());
              t7.onDispose(() => {
                t7 && (this._decorations.delete(t7) && this._onDecorationRemoved.fire(t7), e5.dispose());
              }), this._decorations.insert(t7), this._onDecorationRegistered.fire(t7);
            }
            return t7;
          }
          reset() {
            for (const e4 of this._decorations.values())
              e4.dispose();
            this._decorations.clear();
          }
          *getDecorationsAtCell(e4, t7, i9) {
            var s12, r5, n9;
            let o6 = 0, a9 = 0;
            for (const h4 of this._decorations.getKeyIterator(t7))
              o6 = null !== (s12 = h4.options.x) && void 0 !== s12 ? s12 : 0, a9 = o6 + (null !== (r5 = h4.options.width) && void 0 !== r5 ? r5 : 1), e4 >= o6 && e4 < a9 && (!i9 || (null !== (n9 = h4.options.layer) && void 0 !== n9 ? n9 : "bottom") === i9) && (yield h4);
          }
          forEachDecorationAtCell(e4, t7, i9, s12) {
            this._decorations.forEachByKey(t7, (t8) => {
              var r5, n9, o6;
              a8 = null !== (r5 = t8.options.x) && void 0 !== r5 ? r5 : 0, h3 = a8 + (null !== (n9 = t8.options.width) && void 0 !== n9 ? n9 : 1), e4 >= a8 && e4 < h3 && (!i9 || (null !== (o6 = t8.options.layer) && void 0 !== o6 ? o6 : "bottom") === i9) && s12(t8);
            });
          }
        }
        t6.DecorationService = c12;
        class l9 extends n8.Disposable {
          get isDisposed() {
            return this._isDisposed;
          }
          get backgroundColorRGB() {
            return null === this._cachedBg && (this.options.backgroundColor ? this._cachedBg = s11.css.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
          }
          get foregroundColorRGB() {
            return null === this._cachedFg && (this.options.foregroundColor ? this._cachedFg = s11.css.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
          }
          constructor(e4) {
            super(), this.options = e4, this.onRenderEmitter = this.register(new r4.EventEmitter()), this.onRender = this.onRenderEmitter.event, this._onDispose = this.register(new r4.EventEmitter()), this.onDispose = this._onDispose.event, this._cachedBg = null, this._cachedFg = null, this.marker = e4.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
          }
          dispose() {
            this._onDispose.fire(), super.dispose();
          }
        }
      }, 4348: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.InstantiationService = t6.ServiceCollection = void 0;
        const s11 = i8(2585), r4 = i8(8343);
        class n8 {
          constructor(...e4) {
            this._entries = /* @__PURE__ */ new Map();
            for (const [t7, i9] of e4)
              this.set(t7, i9);
          }
          set(e4, t7) {
            const i9 = this._entries.get(e4);
            return this._entries.set(e4, t7), i9;
          }
          forEach(e4) {
            for (const [t7, i9] of this._entries.entries())
              e4(t7, i9);
          }
          has(e4) {
            return this._entries.has(e4);
          }
          get(e4) {
            return this._entries.get(e4);
          }
        }
        t6.ServiceCollection = n8, t6.InstantiationService = class {
          constructor() {
            this._services = new n8(), this._services.set(s11.IInstantiationService, this);
          }
          setService(e4, t7) {
            this._services.set(e4, t7);
          }
          getService(e4) {
            return this._services.get(e4);
          }
          createInstance(e4, ...t7) {
            const i9 = (0, r4.getServiceDependencies)(e4).sort((e5, t8) => e5.index - t8.index), s12 = [];
            for (const t8 of i9) {
              const i10 = this._services.get(t8.id);
              if (!i10)
                throw new Error(`[createInstance] ${e4.name} depends on UNKNOWN service ${t8.id}.`);
              s12.push(i10);
            }
            const n9 = i9.length > 0 ? i9[0].index : t7.length;
            if (t7.length !== n9)
              throw new Error(`[createInstance] First service dependency of ${e4.name} at position ${n9 + 1} conflicts with ${t7.length} static arguments`);
            return new e4(...[...t7, ...s12]);
          }
        };
      }, 7866: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a9 = e4.length - 1; a9 >= 0; a9--)
              (r5 = e4[a9]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.traceCall = t6.setTraceLogger = t6.LogService = void 0;
        const n8 = i8(844), o5 = i8(2585), a8 = { trace: o5.LogLevelEnum.TRACE, debug: o5.LogLevelEnum.DEBUG, info: o5.LogLevelEnum.INFO, warn: o5.LogLevelEnum.WARN, error: o5.LogLevelEnum.ERROR, off: o5.LogLevelEnum.OFF };
        let h3, c12 = t6.LogService = class extends n8.Disposable {
          get logLevel() {
            return this._logLevel;
          }
          constructor(e4) {
            super(), this._optionsService = e4, this._logLevel = o5.LogLevelEnum.OFF, this._updateLogLevel(), this.register(this._optionsService.onSpecificOptionChange("logLevel", () => this._updateLogLevel())), h3 = this;
          }
          _updateLogLevel() {
            this._logLevel = a8[this._optionsService.rawOptions.logLevel];
          }
          _evalLazyOptionalParams(e4) {
            for (let t7 = 0; t7 < e4.length; t7++)
              "function" == typeof e4[t7] && (e4[t7] = e4[t7]());
          }
          _log(e4, t7, i9) {
            this._evalLazyOptionalParams(i9), e4.call(console, (this._optionsService.options.logger ? "" : "xterm.js: ") + t7, ...i9);
          }
          trace(e4, ...t7) {
            var i9, s12;
            this._logLevel <= o5.LogLevelEnum.TRACE && this._log(null !== (s12 = null === (i9 = this._optionsService.options.logger) || void 0 === i9 ? void 0 : i9.trace.bind(this._optionsService.options.logger)) && void 0 !== s12 ? s12 : console.log, e4, t7);
          }
          debug(e4, ...t7) {
            var i9, s12;
            this._logLevel <= o5.LogLevelEnum.DEBUG && this._log(null !== (s12 = null === (i9 = this._optionsService.options.logger) || void 0 === i9 ? void 0 : i9.debug.bind(this._optionsService.options.logger)) && void 0 !== s12 ? s12 : console.log, e4, t7);
          }
          info(e4, ...t7) {
            var i9, s12;
            this._logLevel <= o5.LogLevelEnum.INFO && this._log(null !== (s12 = null === (i9 = this._optionsService.options.logger) || void 0 === i9 ? void 0 : i9.info.bind(this._optionsService.options.logger)) && void 0 !== s12 ? s12 : console.info, e4, t7);
          }
          warn(e4, ...t7) {
            var i9, s12;
            this._logLevel <= o5.LogLevelEnum.WARN && this._log(null !== (s12 = null === (i9 = this._optionsService.options.logger) || void 0 === i9 ? void 0 : i9.warn.bind(this._optionsService.options.logger)) && void 0 !== s12 ? s12 : console.warn, e4, t7);
          }
          error(e4, ...t7) {
            var i9, s12;
            this._logLevel <= o5.LogLevelEnum.ERROR && this._log(null !== (s12 = null === (i9 = this._optionsService.options.logger) || void 0 === i9 ? void 0 : i9.error.bind(this._optionsService.options.logger)) && void 0 !== s12 ? s12 : console.error, e4, t7);
          }
        };
        t6.LogService = c12 = s11([r4(0, o5.IOptionsService)], c12), t6.setTraceLogger = function(e4) {
          h3 = e4;
        }, t6.traceCall = function(e4, t7, i9) {
          if ("function" != typeof i9.value)
            throw new Error("not supported");
          const s12 = i9.value;
          i9.value = function(...e5) {
            if (h3.logLevel !== o5.LogLevelEnum.TRACE)
              return s12.apply(this, e5);
            h3.trace(`GlyphRenderer#${s12.name}(${e5.map((e6) => JSON.stringify(e6)).join(", ")})`);
            const t8 = s12.apply(this, e5);
            return h3.trace(`GlyphRenderer#${s12.name} return`, t8), t8;
          };
        };
      }, 7302: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.OptionsService = t6.DEFAULT_OPTIONS = void 0;
        const s11 = i8(8460), r4 = i8(844), n8 = i8(6114);
        t6.DEFAULT_OPTIONS = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "courier-new, courier, monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, rightClickSelectsWord: n8.isMac, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRulerWidth: 0 };
        const o5 = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
        class a8 extends r4.Disposable {
          constructor(e4) {
            super(), this._onOptionChange = this.register(new s11.EventEmitter()), this.onOptionChange = this._onOptionChange.event;
            const i9 = Object.assign({}, t6.DEFAULT_OPTIONS);
            for (const t7 in e4)
              if (t7 in i9)
                try {
                  const s12 = e4[t7];
                  i9[t7] = this._sanitizeAndValidateOption(t7, s12);
                } catch (e5) {
                  console.error(e5);
                }
            this.rawOptions = i9, this.options = Object.assign({}, i9), this._setupOptions();
          }
          onSpecificOptionChange(e4, t7) {
            return this.onOptionChange((i9) => {
              i9 === e4 && t7(this.rawOptions[e4]);
            });
          }
          onMultipleOptionChange(e4, t7) {
            return this.onOptionChange((i9) => {
              -1 !== e4.indexOf(i9) && t7();
            });
          }
          _setupOptions() {
            const e4 = (e5) => {
              if (!(e5 in t6.DEFAULT_OPTIONS))
                throw new Error(`No option with key "${e5}"`);
              return this.rawOptions[e5];
            }, i9 = (e5, i10) => {
              if (!(e5 in t6.DEFAULT_OPTIONS))
                throw new Error(`No option with key "${e5}"`);
              i10 = this._sanitizeAndValidateOption(e5, i10), this.rawOptions[e5] !== i10 && (this.rawOptions[e5] = i10, this._onOptionChange.fire(e5));
            };
            for (const t7 in this.rawOptions) {
              const s12 = { get: e4.bind(this, t7), set: i9.bind(this, t7) };
              Object.defineProperty(this.options, t7, s12);
            }
          }
          _sanitizeAndValidateOption(e4, i9) {
            switch (e4) {
              case "cursorStyle":
                if (i9 || (i9 = t6.DEFAULT_OPTIONS[e4]), !function(e5) {
                  return "block" === e5 || "underline" === e5 || "bar" === e5;
                }(i9))
                  throw new Error(`"${i9}" is not a valid value for ${e4}`);
                break;
              case "wordSeparator":
                i9 || (i9 = t6.DEFAULT_OPTIONS[e4]);
                break;
              case "fontWeight":
              case "fontWeightBold":
                if ("number" == typeof i9 && 1 <= i9 && i9 <= 1e3)
                  break;
                i9 = o5.includes(i9) ? i9 : t6.DEFAULT_OPTIONS[e4];
                break;
              case "cursorWidth":
                i9 = Math.floor(i9);
              case "lineHeight":
              case "tabStopWidth":
                if (i9 < 1)
                  throw new Error(`${e4} cannot be less than 1, value: ${i9}`);
                break;
              case "minimumContrastRatio":
                i9 = Math.max(1, Math.min(21, Math.round(10 * i9) / 10));
                break;
              case "scrollback":
                if ((i9 = Math.min(i9, 4294967295)) < 0)
                  throw new Error(`${e4} cannot be less than 0, value: ${i9}`);
                break;
              case "fastScrollSensitivity":
              case "scrollSensitivity":
                if (i9 <= 0)
                  throw new Error(`${e4} cannot be less than or equal to 0, value: ${i9}`);
                break;
              case "rows":
              case "cols":
                if (!i9 && 0 !== i9)
                  throw new Error(`${e4} must be numeric, value: ${i9}`);
                break;
              case "windowsPty":
                i9 = null != i9 ? i9 : {};
            }
            return i9;
          }
        }
        t6.OptionsService = a8;
      }, 2660: function(e3, t6, i8) {
        var s11 = this && this.__decorate || function(e4, t7, i9, s12) {
          var r5, n9 = arguments.length, o6 = n9 < 3 ? t7 : null === s12 ? s12 = Object.getOwnPropertyDescriptor(t7, i9) : s12;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            o6 = Reflect.decorate(e4, t7, i9, s12);
          else
            for (var a8 = e4.length - 1; a8 >= 0; a8--)
              (r5 = e4[a8]) && (o6 = (n9 < 3 ? r5(o6) : n9 > 3 ? r5(t7, i9, o6) : r5(t7, i9)) || o6);
          return n9 > 3 && o6 && Object.defineProperty(t7, i9, o6), o6;
        }, r4 = this && this.__param || function(e4, t7) {
          return function(i9, s12) {
            t7(i9, s12, e4);
          };
        };
        Object.defineProperty(t6, "__esModule", { value: true }), t6.OscLinkService = void 0;
        const n8 = i8(2585);
        let o5 = t6.OscLinkService = class {
          constructor(e4) {
            this._bufferService = e4, this._nextId = 1, this._entriesWithId = /* @__PURE__ */ new Map(), this._dataByLinkId = /* @__PURE__ */ new Map();
          }
          registerLink(e4) {
            const t7 = this._bufferService.buffer;
            if (void 0 === e4.id) {
              const i10 = t7.addMarker(t7.ybase + t7.y), s13 = { data: e4, id: this._nextId++, lines: [i10] };
              return i10.onDispose(() => this._removeMarkerFromLink(s13, i10)), this._dataByLinkId.set(s13.id, s13), s13.id;
            }
            const i9 = e4, s12 = this._getEntryIdKey(i9), r5 = this._entriesWithId.get(s12);
            if (r5)
              return this.addLineToLink(r5.id, t7.ybase + t7.y), r5.id;
            const n9 = t7.addMarker(t7.ybase + t7.y), o6 = { id: this._nextId++, key: this._getEntryIdKey(i9), data: i9, lines: [n9] };
            return n9.onDispose(() => this._removeMarkerFromLink(o6, n9)), this._entriesWithId.set(o6.key, o6), this._dataByLinkId.set(o6.id, o6), o6.id;
          }
          addLineToLink(e4, t7) {
            const i9 = this._dataByLinkId.get(e4);
            if (i9 && i9.lines.every((e5) => e5.line !== t7)) {
              const e5 = this._bufferService.buffer.addMarker(t7);
              i9.lines.push(e5), e5.onDispose(() => this._removeMarkerFromLink(i9, e5));
            }
          }
          getLinkData(e4) {
            var t7;
            return null === (t7 = this._dataByLinkId.get(e4)) || void 0 === t7 ? void 0 : t7.data;
          }
          _getEntryIdKey(e4) {
            return `${e4.id};;${e4.uri}`;
          }
          _removeMarkerFromLink(e4, t7) {
            const i9 = e4.lines.indexOf(t7);
            -1 !== i9 && (e4.lines.splice(i9, 1), 0 === e4.lines.length && (void 0 !== e4.data.id && this._entriesWithId.delete(e4.key), this._dataByLinkId.delete(e4.id)));
          }
        };
        t6.OscLinkService = o5 = s11([r4(0, n8.IBufferService)], o5);
      }, 8343: (e3, t6) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.createDecorator = t6.getServiceDependencies = t6.serviceRegistry = void 0;
        const i8 = "di$target", s11 = "di$dependencies";
        t6.serviceRegistry = /* @__PURE__ */ new Map(), t6.getServiceDependencies = function(e4) {
          return e4[s11] || [];
        }, t6.createDecorator = function(e4) {
          if (t6.serviceRegistry.has(e4))
            return t6.serviceRegistry.get(e4);
          const r4 = function(e5, t7, n8) {
            if (3 !== arguments.length)
              throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
            !function(e6, t8, r5) {
              t8[i8] === t8 ? t8[s11].push({ id: e6, index: r5 }) : (t8[s11] = [{ id: e6, index: r5 }], t8[i8] = t8);
            }(r4, e5, n8);
          };
          return r4.toString = () => e4, t6.serviceRegistry.set(e4, r4), r4;
        };
      }, 2585: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.IDecorationService = t6.IUnicodeService = t6.IOscLinkService = t6.IOptionsService = t6.ILogService = t6.LogLevelEnum = t6.IInstantiationService = t6.ICharsetService = t6.ICoreService = t6.ICoreMouseService = t6.IBufferService = void 0;
        const s11 = i8(8343);
        var r4;
        t6.IBufferService = (0, s11.createDecorator)("BufferService"), t6.ICoreMouseService = (0, s11.createDecorator)("CoreMouseService"), t6.ICoreService = (0, s11.createDecorator)("CoreService"), t6.ICharsetService = (0, s11.createDecorator)("CharsetService"), t6.IInstantiationService = (0, s11.createDecorator)("InstantiationService"), function(e4) {
          e4[e4.TRACE = 0] = "TRACE", e4[e4.DEBUG = 1] = "DEBUG", e4[e4.INFO = 2] = "INFO", e4[e4.WARN = 3] = "WARN", e4[e4.ERROR = 4] = "ERROR", e4[e4.OFF = 5] = "OFF";
        }(r4 || (t6.LogLevelEnum = r4 = {})), t6.ILogService = (0, s11.createDecorator)("LogService"), t6.IOptionsService = (0, s11.createDecorator)("OptionsService"), t6.IOscLinkService = (0, s11.createDecorator)("OscLinkService"), t6.IUnicodeService = (0, s11.createDecorator)("UnicodeService"), t6.IDecorationService = (0, s11.createDecorator)("DecorationService");
      }, 1480: (e3, t6, i8) => {
        Object.defineProperty(t6, "__esModule", { value: true }), t6.UnicodeService = void 0;
        const s11 = i8(8460), r4 = i8(225);
        t6.UnicodeService = class {
          constructor() {
            this._providers = /* @__PURE__ */ Object.create(null), this._active = "", this._onChange = new s11.EventEmitter(), this.onChange = this._onChange.event;
            const e4 = new r4.UnicodeV6();
            this.register(e4), this._active = e4.version, this._activeProvider = e4;
          }
          dispose() {
            this._onChange.dispose();
          }
          get versions() {
            return Object.keys(this._providers);
          }
          get activeVersion() {
            return this._active;
          }
          set activeVersion(e4) {
            if (!this._providers[e4])
              throw new Error(`unknown Unicode version "${e4}"`);
            this._active = e4, this._activeProvider = this._providers[e4], this._onChange.fire(e4);
          }
          register(e4) {
            this._providers[e4.version] = e4;
          }
          wcwidth(e4) {
            return this._activeProvider.wcwidth(e4);
          }
          getStringCellWidth(e4) {
            let t7 = 0;
            const i9 = e4.length;
            for (let s12 = 0; s12 < i9; ++s12) {
              let r5 = e4.charCodeAt(s12);
              if (55296 <= r5 && r5 <= 56319) {
                if (++s12 >= i9)
                  return t7 + this.wcwidth(r5);
                const n8 = e4.charCodeAt(s12);
                56320 <= n8 && n8 <= 57343 ? r5 = 1024 * (r5 - 55296) + n8 - 56320 + 65536 : t7 += this.wcwidth(n8);
              }
              t7 += this.wcwidth(r5);
            }
            return t7;
          }
        };
      } }, t5 = {};
      function i7(s11) {
        var r4 = t5[s11];
        if (void 0 !== r4)
          return r4.exports;
        var n8 = t5[s11] = { exports: {} };
        return e2[s11].call(n8.exports, n8, n8.exports, i7), n8.exports;
      }
      var s10 = {};
      return (() => {
        var e3 = s10;
        Object.defineProperty(e3, "__esModule", { value: true }), e3.Terminal = void 0;
        const t6 = i7(9042), r4 = i7(3236), n8 = i7(844), o5 = i7(5741), a8 = i7(8285), h3 = i7(7975), c12 = i7(7090), l9 = ["cols", "rows"];
        class d7 extends n8.Disposable {
          constructor(e4) {
            super(), this._core = this.register(new r4.Terminal(e4)), this._addonManager = this.register(new o5.AddonManager()), this._publicOptions = Object.assign({}, this._core.options);
            const t7 = (e5) => this._core.options[e5], i8 = (e5, t8) => {
              this._checkReadonlyOptions(e5), this._core.options[e5] = t8;
            };
            for (const e5 in this._core.options) {
              const s11 = { get: t7.bind(this, e5), set: i8.bind(this, e5) };
              Object.defineProperty(this._publicOptions, e5, s11);
            }
          }
          _checkReadonlyOptions(e4) {
            if (l9.includes(e4))
              throw new Error(`Option "${e4}" can only be set in the constructor`);
          }
          _checkProposedApi() {
            if (!this._core.optionsService.rawOptions.allowProposedApi)
              throw new Error("You must set the allowProposedApi option to true to use proposed API");
          }
          get onBell() {
            return this._core.onBell;
          }
          get onBinary() {
            return this._core.onBinary;
          }
          get onCursorMove() {
            return this._core.onCursorMove;
          }
          get onData() {
            return this._core.onData;
          }
          get onKey() {
            return this._core.onKey;
          }
          get onLineFeed() {
            return this._core.onLineFeed;
          }
          get onRender() {
            return this._core.onRender;
          }
          get onResize() {
            return this._core.onResize;
          }
          get onScroll() {
            return this._core.onScroll;
          }
          get onSelectionChange() {
            return this._core.onSelectionChange;
          }
          get onTitleChange() {
            return this._core.onTitleChange;
          }
          get onWriteParsed() {
            return this._core.onWriteParsed;
          }
          get element() {
            return this._core.element;
          }
          get parser() {
            return this._parser || (this._parser = new h3.ParserApi(this._core)), this._parser;
          }
          get unicode() {
            return this._checkProposedApi(), new c12.UnicodeApi(this._core);
          }
          get textarea() {
            return this._core.textarea;
          }
          get rows() {
            return this._core.rows;
          }
          get cols() {
            return this._core.cols;
          }
          get buffer() {
            return this._buffer || (this._buffer = this.register(new a8.BufferNamespaceApi(this._core))), this._buffer;
          }
          get markers() {
            return this._checkProposedApi(), this._core.markers;
          }
          get modes() {
            const e4 = this._core.coreService.decPrivateModes;
            let t7 = "none";
            switch (this._core.coreMouseService.activeProtocol) {
              case "X10":
                t7 = "x10";
                break;
              case "VT200":
                t7 = "vt200";
                break;
              case "DRAG":
                t7 = "drag";
                break;
              case "ANY":
                t7 = "any";
            }
            return { applicationCursorKeysMode: e4.applicationCursorKeys, applicationKeypadMode: e4.applicationKeypad, bracketedPasteMode: e4.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: t7, originMode: e4.origin, reverseWraparoundMode: e4.reverseWraparound, sendFocusMode: e4.sendFocus, wraparoundMode: e4.wraparound };
          }
          get options() {
            return this._publicOptions;
          }
          set options(e4) {
            for (const t7 in e4)
              this._publicOptions[t7] = e4[t7];
          }
          blur() {
            this._core.blur();
          }
          focus() {
            this._core.focus();
          }
          resize(e4, t7) {
            this._verifyIntegers(e4, t7), this._core.resize(e4, t7);
          }
          open(e4) {
            this._core.open(e4);
          }
          attachCustomKeyEventHandler(e4) {
            this._core.attachCustomKeyEventHandler(e4);
          }
          registerLinkProvider(e4) {
            return this._core.registerLinkProvider(e4);
          }
          registerCharacterJoiner(e4) {
            return this._checkProposedApi(), this._core.registerCharacterJoiner(e4);
          }
          deregisterCharacterJoiner(e4) {
            this._checkProposedApi(), this._core.deregisterCharacterJoiner(e4);
          }
          registerMarker(e4 = 0) {
            return this._verifyIntegers(e4), this._core.registerMarker(e4);
          }
          registerDecoration(e4) {
            var t7, i8, s11;
            return this._checkProposedApi(), this._verifyPositiveIntegers(null !== (t7 = e4.x) && void 0 !== t7 ? t7 : 0, null !== (i8 = e4.width) && void 0 !== i8 ? i8 : 0, null !== (s11 = e4.height) && void 0 !== s11 ? s11 : 0), this._core.registerDecoration(e4);
          }
          hasSelection() {
            return this._core.hasSelection();
          }
          select(e4, t7, i8) {
            this._verifyIntegers(e4, t7, i8), this._core.select(e4, t7, i8);
          }
          getSelection() {
            return this._core.getSelection();
          }
          getSelectionPosition() {
            return this._core.getSelectionPosition();
          }
          clearSelection() {
            this._core.clearSelection();
          }
          selectAll() {
            this._core.selectAll();
          }
          selectLines(e4, t7) {
            this._verifyIntegers(e4, t7), this._core.selectLines(e4, t7);
          }
          dispose() {
            super.dispose();
          }
          scrollLines(e4) {
            this._verifyIntegers(e4), this._core.scrollLines(e4);
          }
          scrollPages(e4) {
            this._verifyIntegers(e4), this._core.scrollPages(e4);
          }
          scrollToTop() {
            this._core.scrollToTop();
          }
          scrollToBottom() {
            this._core.scrollToBottom();
          }
          scrollToLine(e4) {
            this._verifyIntegers(e4), this._core.scrollToLine(e4);
          }
          clear() {
            this._core.clear();
          }
          write(e4, t7) {
            this._core.write(e4, t7);
          }
          writeln(e4, t7) {
            this._core.write(e4), this._core.write("\r\n", t7);
          }
          paste(e4) {
            this._core.paste(e4);
          }
          refresh(e4, t7) {
            this._verifyIntegers(e4, t7), this._core.refresh(e4, t7);
          }
          reset() {
            this._core.reset();
          }
          clearTextureAtlas() {
            this._core.clearTextureAtlas();
          }
          loadAddon(e4) {
            this._addonManager.loadAddon(this, e4);
          }
          static get strings() {
            return t6;
          }
          _verifyIntegers(...e4) {
            for (const t7 of e4)
              if (t7 === 1 / 0 || isNaN(t7) || t7 % 1 != 0)
                throw new Error("This API only accepts integers");
          }
          _verifyPositiveIntegers(...e4) {
            for (const t7 of e4)
              if (t7 && (t7 === 1 / 0 || isNaN(t7) || t7 % 1 != 0 || t7 < 0))
                throw new Error("This API only accepts positive integers");
          }
        }
        e3.Terminal = d7;
      })(), s10;
    })());
  }
});

// ../../node_modules/.pnpm/xterm-addon-fit@0.7.0_xterm@5.3.0/node_modules/xterm-addon-fit/lib/xterm-addon-fit.js
var require_xterm_addon_fit = __commonJS({
  "../../node_modules/.pnpm/xterm-addon-fit@0.7.0_xterm@5.3.0/node_modules/xterm-addon-fit/lib/xterm-addon-fit.js"(exports, module2) {
    !function(e2, t5) {
      "object" == typeof exports && "object" == typeof module2 ? module2.exports = t5() : "function" == typeof define && define.amd ? define([], t5) : "object" == typeof exports ? exports.FitAddon = t5() : e2.FitAddon = t5();
    }(self, function() {
      return (() => {
        "use strict";
        var e2 = {};
        return (() => {
          var t5 = e2;
          Object.defineProperty(t5, "__esModule", { value: true }), t5.FitAddon = void 0, t5.FitAddon = class {
            constructor() {
            }
            activate(e3) {
              this._terminal = e3;
            }
            dispose() {
            }
            fit() {
              const e3 = this.proposeDimensions();
              if (!e3 || !this._terminal || isNaN(e3.cols) || isNaN(e3.rows))
                return;
              const t6 = this._terminal._core;
              this._terminal.rows === e3.rows && this._terminal.cols === e3.cols || (t6._renderService.clear(), this._terminal.resize(e3.cols, e3.rows));
            }
            proposeDimensions() {
              if (!this._terminal)
                return;
              if (!this._terminal.element || !this._terminal.element.parentElement)
                return;
              const e3 = this._terminal._core, t6 = e3._renderService.dimensions;
              if (0 === t6.css.cell.width || 0 === t6.css.cell.height)
                return;
              const r4 = 0 === this._terminal.options.scrollback ? 0 : e3.viewport.scrollBarWidth, i7 = window.getComputedStyle(this._terminal.element.parentElement), o5 = parseInt(i7.getPropertyValue("height")), s10 = Math.max(0, parseInt(i7.getPropertyValue("width"))), n8 = window.getComputedStyle(this._terminal.element), l9 = o5 - (parseInt(n8.getPropertyValue("padding-top")) + parseInt(n8.getPropertyValue("padding-bottom"))), a8 = s10 - (parseInt(n8.getPropertyValue("padding-right")) + parseInt(n8.getPropertyValue("padding-left"))) - r4;
              return { cols: Math.max(2, Math.floor(a8 / t6.css.cell.width)), rows: Math.max(1, Math.floor(l9 / t6.css.cell.height)) };
            }
          };
        })(), e2;
      })();
    });
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/keymap.js
var require_keymap = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/keymap.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseInput = exports.InputType = void 0;
    var InputType;
    (function(InputType2) {
      InputType2[InputType2["Text"] = 0] = "Text";
      InputType2[InputType2["AltEnter"] = 1] = "AltEnter";
      InputType2[InputType2["ArrowUp"] = 2] = "ArrowUp";
      InputType2[InputType2["ArrowDown"] = 3] = "ArrowDown";
      InputType2[InputType2["ArrowLeft"] = 4] = "ArrowLeft";
      InputType2[InputType2["ArrowRight"] = 5] = "ArrowRight";
      InputType2[InputType2["Delete"] = 6] = "Delete";
      InputType2[InputType2["Backspace"] = 7] = "Backspace";
      InputType2[InputType2["CtrlA"] = 8] = "CtrlA";
      InputType2[InputType2["CtrlC"] = 9] = "CtrlC";
      InputType2[InputType2["CtrlD"] = 10] = "CtrlD";
      InputType2[InputType2["CtrlE"] = 11] = "CtrlE";
      InputType2[InputType2["CtrlK"] = 12] = "CtrlK";
      InputType2[InputType2["CtrlL"] = 13] = "CtrlL";
      InputType2[InputType2["CtrlQ"] = 14] = "CtrlQ";
      InputType2[InputType2["CtrlS"] = 15] = "CtrlS";
      InputType2[InputType2["CtrlU"] = 16] = "CtrlU";
      InputType2[InputType2["End"] = 17] = "End";
      InputType2[InputType2["Enter"] = 18] = "Enter";
      InputType2[InputType2["Home"] = 19] = "Home";
      InputType2[InputType2["ShiftEnter"] = 20] = "ShiftEnter";
      InputType2[InputType2["UnsupportedControlChar"] = 21] = "UnsupportedControlChar";
      InputType2[InputType2["UnsupportedEscape"] = 22] = "UnsupportedEscape";
    })(InputType = exports.InputType || (exports.InputType = {}));
    function parseInput(data) {
      return Array.from(splitInput(data));
    }
    exports.parseInput = parseInput;
    function* splitInput(data) {
      let text = [];
      const it = data[Symbol.iterator]();
      for (let next = it.next(); !next.done; next = it.next()) {
        const c12 = next.value;
        if (c12.length > 1) {
          text.push(c12);
          continue;
        }
        const val = c12.charCodeAt(0);
        if (text.length > 0 && (val < 32 || val === 127)) {
          yield {
            inputType: InputType.Text,
            data: text
          };
          text = [];
        }
        if (val === 27) {
          const seq2 = it.next();
          if (seq2.done) {
            text.push("\x1B");
            continue;
          }
          let inputType = InputType.UnsupportedEscape;
          if (seq2.value !== "[") {
            switch (seq2.value) {
              case "\r":
                inputType = InputType.AltEnter;
                break;
            }
            yield {
              inputType,
              data: ["\x1B", seq2.value]
            };
            continue;
          }
          const seq3 = it.next();
          if (seq3.done) {
            continue;
          }
          if (seq3.value >= "0" && seq3.value <= "9") {
            let digit = seq3.value;
            const nextDigit = it.next();
            if (nextDigit.done) {
              return;
            }
            if (nextDigit.value >= "0" && nextDigit.value <= "9") {
              digit += nextDigit.value;
            } else if (nextDigit.value !== "~") {
              continue;
            }
            switch (digit) {
              case "3":
                inputType = InputType.Delete;
                break;
            }
            yield {
              inputType,
              data: ["\x1B", "[", digit, "~"]
            };
            continue;
          }
          switch (seq3.value) {
            case "A":
              inputType = InputType.ArrowUp;
              break;
            case "B":
              inputType = InputType.ArrowDown;
              break;
            case "C":
              inputType = InputType.ArrowRight;
              break;
            case "D":
              inputType = InputType.ArrowLeft;
              break;
            case "F":
              inputType = InputType.End;
              break;
            case "H":
              inputType = InputType.Home;
              break;
            case "\r":
              inputType = InputType.AltEnter;
              break;
          }
          yield {
            inputType,
            data: ["\x1B", "[", seq3.value]
          };
          continue;
        }
        if (val < 32 || val === 127) {
          let inputType = InputType.UnsupportedControlChar;
          switch (val) {
            case 1:
              inputType = InputType.CtrlA;
              break;
            case 3:
              inputType = InputType.CtrlC;
              break;
            case 4:
              inputType = InputType.CtrlD;
              break;
            case 5:
              inputType = InputType.CtrlE;
              break;
            case 11:
              inputType = InputType.CtrlK;
              break;
            case 17:
              inputType = InputType.CtrlQ;
              break;
            case 19:
              inputType = InputType.CtrlS;
              break;
            case 21:
              inputType = InputType.CtrlU;
              break;
            case 13:
              inputType = InputType.Enter;
              break;
            case 127:
              inputType = InputType.Backspace;
              break;
            case 12:
              inputType = InputType.CtrlL;
              break;
          }
          yield {
            inputType,
            data: [c12]
          };
          continue;
        }
        text.push(c12);
      }
      if (text.length > 0) {
        yield {
          inputType: InputType.Text,
          data: text
        };
      }
    }
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/line.js
var require_line = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/line.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LineBuffer = void 0;
    var LineBuffer = class {
      constructor() {
        this.buf = "";
        this.pos = 0;
      }
      buffer() {
        return this.buf;
      }
      pos_buffer() {
        return this.buf.slice(0, this.pos);
      }
      // Return length of buffer in bytes
      length() {
        return this.buf.length;
      }
      // Return length of buffer in characters
      char_length() {
        return [...this.buf].length;
      }
      // Set text and position
      update(text, pos) {
        this.buf = text;
        this.pos = pos;
      }
      insert(text) {
        const shift = text.length;
        const push = this.pos === this.buf.length;
        if (push) {
          this.buf = this.buf + text;
        } else {
          this.buf = this.buf.slice(0, this.pos) + text + this.buf.slice(this.pos);
        }
        this.pos += shift;
        return push;
      }
      moveBack(n8) {
        const pos = this.prevPos(n8);
        if (pos !== void 0) {
          this.pos = pos;
          return true;
        } else {
          return false;
        }
      }
      moveForward(n8) {
        const pos = this.nextPos(n8);
        if (pos !== void 0) {
          this.pos = pos;
          return true;
        } else {
          return false;
        }
      }
      moveHome() {
        const start = this.startOfLine();
        if (this.pos > start) {
          this.pos = start;
          return true;
        }
        return false;
      }
      moveEnd() {
        const end = this.endOfLine();
        if (this.pos === end) {
          return false;
        }
        this.pos = end;
        return true;
      }
      startOfLine() {
        const start = this.buf.slice(0, this.pos).lastIndexOf("\n");
        if (start !== -1) {
          return start + 1;
        } else {
          return 0;
        }
      }
      endOfLine() {
        const end = this.buf.slice(this.pos).indexOf("\n");
        if (end !== -1) {
          return this.pos + end;
        } else {
          return this.buf.length;
        }
      }
      moveLineUp(n8) {
        const off = this.buf.slice(0, this.pos).lastIndexOf("\n");
        if (off === -1) {
          return false;
        }
        const column = [...this.buf.slice(off + 1, this.pos)].length;
        let destStart = this.buf.slice(0, off).lastIndexOf("\n");
        if (destStart === -1) {
          destStart = 0;
        } else {
          destStart = destStart + 1;
        }
        let destEnd = off;
        for (let i7 = 1; i7 < n8; i7++) {
          if (destStart === 0) {
            break;
          }
          destEnd = destStart - 1;
          destStart = this.buf.slice(0, destEnd).lastIndexOf("\n");
          if (destStart === -1) {
            destStart = 0;
          } else {
            destStart = destStart + 1;
          }
        }
        const slice = [...this.buf.slice(destStart, destEnd)].slice(0, column);
        let gIdx = off;
        if (slice.length > 0) {
          gIdx = slice.map((c12) => c12.length).reduce((acc, m8) => acc + m8, 0);
          gIdx = destStart + gIdx;
        }
        this.pos = gIdx;
        return true;
      }
      moveLineDown(n8) {
        const off = this.buf.slice(this.pos).indexOf("\n");
        if (off === -1) {
          return false;
        }
        let lineStart = this.buf.slice(0, this.pos).lastIndexOf("\n");
        if (lineStart === -1) {
          lineStart = 0;
        } else {
          lineStart += 1;
        }
        const column = [...this.buf.slice(lineStart, this.pos)].length;
        let destStart = this.pos + off + 1;
        let destEnd = this.buf.slice(destStart).indexOf("\n");
        if (destEnd === -1) {
          destEnd = this.buf.length;
        } else {
          destEnd = destStart + destEnd;
        }
        for (let i7 = 1; i7 < n8; i7++) {
          if (destEnd === this.buf.length) {
            break;
          }
          destStart = destEnd + 1;
          destEnd = this.buf.slice(destStart).indexOf("\n");
          if (destEnd === -1) {
            destEnd = this.buf.length;
          } else {
            destEnd = destStart + destEnd;
          }
        }
        const slice = [...this.buf.slice(destStart, destEnd)];
        if (column < slice.length) {
          this.pos = slice.slice(0, column).map((c12) => c12.length).reduce((acc, m8) => acc + m8, 0) + destStart;
        } else {
          this.pos = destEnd;
        }
        return true;
      }
      // Set position of cursor
      set_pos(pos) {
        this.pos = pos;
      }
      // Return the position of the character preceding
      // pos
      prevPos(n8) {
        if (this.pos === 0) {
          return void 0;
        }
        const buf = this.buf.slice(0, this.pos);
        return this.pos - [...buf].slice(-n8).map((c12) => c12.length).reduce((acc, m8) => acc + m8, 0);
      }
      // Return the position of the character following the
      // current pos
      nextPos(n8) {
        if (this.pos === this.buf.length) {
          return void 0;
        }
        const buf = this.buf.slice(this.pos);
        return this.pos + [...buf].slice(0, n8).map((c12) => c12.length).reduce((acc, m8) => acc + m8, 0);
      }
      backspace(n8) {
        const newPos = this.prevPos(n8);
        if (newPos === void 0) {
          return false;
        }
        this.buf = this.buf.slice(0, newPos) + this.buf.slice(this.pos);
        this.pos = newPos;
        return true;
      }
      delete(n8) {
        const nextChar = this.nextPos(n8);
        if (nextChar !== void 0) {
          this.buf = this.buf.slice(0, this.pos) + this.buf.slice(nextChar);
          return true;
        } else {
          return false;
        }
      }
      deleteEndOfLine() {
        if (this.buf.length == 0 || this.pos == this.buf.length) {
          return false;
        }
        const start = this.pos;
        const end = this.endOfLine();
        if (start == end) {
          this.delete(1);
        } else {
          this.buf = this.buf.slice(0, start) + this.buf.slice(end);
        }
        return true;
      }
    };
    exports.LineBuffer = LineBuffer;
  }
});

// ../../node_modules/.pnpm/ansi-regex@5.0.1/node_modules/ansi-regex/index.js
var require_ansi_regex = __commonJS({
  "../../node_modules/.pnpm/ansi-regex@5.0.1/node_modules/ansi-regex/index.js"(exports, module2) {
    "use strict";
    module2.exports = ({ onlyFirst = false } = {}) => {
      const pattern = [
        "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
        "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))"
      ].join("|");
      return new RegExp(pattern, onlyFirst ? void 0 : "g");
    };
  }
});

// ../../node_modules/.pnpm/strip-ansi@6.0.1/node_modules/strip-ansi/index.js
var require_strip_ansi = __commonJS({
  "../../node_modules/.pnpm/strip-ansi@6.0.1/node_modules/strip-ansi/index.js"(exports, module2) {
    "use strict";
    var ansiRegex = require_ansi_regex();
    module2.exports = (string) => typeof string === "string" ? string.replace(ansiRegex(), "") : string;
  }
});

// ../../node_modules/.pnpm/is-fullwidth-code-point@3.0.0/node_modules/is-fullwidth-code-point/index.js
var require_is_fullwidth_code_point = __commonJS({
  "../../node_modules/.pnpm/is-fullwidth-code-point@3.0.0/node_modules/is-fullwidth-code-point/index.js"(exports, module2) {
    "use strict";
    var isFullwidthCodePoint = (codePoint) => {
      if (Number.isNaN(codePoint)) {
        return false;
      }
      if (codePoint >= 4352 && (codePoint <= 4447 || // Hangul Jamo
      codePoint === 9001 || // LEFT-POINTING ANGLE BRACKET
      codePoint === 9002 || // RIGHT-POINTING ANGLE BRACKET
      // CJK Radicals Supplement .. Enclosed CJK Letters and Months
      11904 <= codePoint && codePoint <= 12871 && codePoint !== 12351 || // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
      12880 <= codePoint && codePoint <= 19903 || // CJK Unified Ideographs .. Yi Radicals
      19968 <= codePoint && codePoint <= 42182 || // Hangul Jamo Extended-A
      43360 <= codePoint && codePoint <= 43388 || // Hangul Syllables
      44032 <= codePoint && codePoint <= 55203 || // CJK Compatibility Ideographs
      63744 <= codePoint && codePoint <= 64255 || // Vertical Forms
      65040 <= codePoint && codePoint <= 65049 || // CJK Compatibility Forms .. Small Form Variants
      65072 <= codePoint && codePoint <= 65131 || // Halfwidth and Fullwidth Forms
      65281 <= codePoint && codePoint <= 65376 || 65504 <= codePoint && codePoint <= 65510 || // Kana Supplement
      110592 <= codePoint && codePoint <= 110593 || // Enclosed Ideographic Supplement
      127488 <= codePoint && codePoint <= 127569 || // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
      131072 <= codePoint && codePoint <= 262141)) {
        return true;
      }
      return false;
    };
    module2.exports = isFullwidthCodePoint;
    module2.exports.default = isFullwidthCodePoint;
  }
});

// ../../node_modules/.pnpm/emoji-regex@8.0.0/node_modules/emoji-regex/index.js
var require_emoji_regex = __commonJS({
  "../../node_modules/.pnpm/emoji-regex@8.0.0/node_modules/emoji-regex/index.js"(exports, module2) {
    "use strict";
    module2.exports = function() {
      return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F|\uD83D\uDC68(?:\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68\uD83C\uDFFB|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|[\u2695\u2696\u2708]\uFE0F|\uD83D[\uDC66\uDC67]|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708])\uFE0F|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C[\uDFFB-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)\uD83C\uDFFB|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB\uDFFC])|\uD83D\uDC69(?:\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB-\uDFFD])|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|(?:(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)\uFE0F|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\u200D[\u2640\u2642])|\uD83C\uDFF4\u200D\u2620)\uFE0F|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF4\uD83C\uDDF2|\uD83C\uDDF6\uD83C\uDDE6|[#\*0-9]\uFE0F\u20E3|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83D\uDC69(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270A-\u270D]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC70\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDCAA\uDD74\uDD7A\uDD90\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD36\uDDB5\uDDB6\uDDBB\uDDD2-\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5\uDEEB\uDEEC\uDEF4-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
    };
  }
});

// ../../node_modules/.pnpm/string-width@4.2.3/node_modules/string-width/index.js
var require_string_width = __commonJS({
  "../../node_modules/.pnpm/string-width@4.2.3/node_modules/string-width/index.js"(exports, module2) {
    "use strict";
    var stripAnsi = require_strip_ansi();
    var isFullwidthCodePoint = require_is_fullwidth_code_point();
    var emojiRegex = require_emoji_regex();
    var stringWidth = (string) => {
      if (typeof string !== "string" || string.length === 0) {
        return 0;
      }
      string = stripAnsi(string);
      if (string.length === 0) {
        return 0;
      }
      string = string.replace(emojiRegex(), "  ");
      let width = 0;
      for (let i7 = 0; i7 < string.length; i7++) {
        const code = string.codePointAt(i7);
        if (code <= 31 || code >= 127 && code <= 159) {
          continue;
        }
        if (code >= 768 && code <= 879) {
          continue;
        }
        if (code > 65535) {
          i7++;
        }
        width += isFullwidthCodePoint(code) ? 2 : 1;
      }
      return width;
    };
    module2.exports = stringWidth;
    module2.exports.default = stringWidth;
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/state.js
var require_state = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/state.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.State = exports.Layout = exports.Position = void 0;
    var line_1 = require_line();
    var string_width_1 = __importDefault(require_string_width());
    var Position = class {
      constructor(rows, cols) {
        if (rows !== void 0) {
          this.row = rows;
        } else {
          this.row = 0;
        }
        if (cols !== void 0) {
          this.col = cols;
        } else {
          this.col = 0;
        }
      }
    };
    exports.Position = Position;
    var Layout = class {
      constructor(promptSize) {
        this.promptSize = promptSize;
        this.cursor = new Position();
        this.end = new Position();
      }
    };
    exports.Layout = Layout;
    var State = class {
      constructor(prompt, tty, highlighter, history) {
        this.line = new line_1.LineBuffer();
        this.highlighting = false;
        this.prompt = prompt;
        this.tty = tty;
        this.highlighter = highlighter;
        this.history = history;
        this.promptSize = tty.calculatePosition(prompt, new Position());
        this.layout = new Layout(this.promptSize);
      }
      buffer() {
        return this.line.buffer();
      }
      shouldHighlight() {
        const highlighting = this.highlighter.highlightChar(this.line.buf, this.line.pos);
        if (highlighting) {
          this.highlighting = true;
          return true;
        } else if (this.highlighting) {
          this.highlighting = false;
          return true;
        } else {
          return false;
        }
      }
      clearScreen() {
        this.tty.clearScreen();
        this.layout.cursor = new Position();
        this.layout.end = new Position();
        this.refresh();
      }
      editInsert(text) {
        const push = this.line.insert(text);
        const multiline = text.includes("\n");
        if (push && !multiline) {
          const width = (0, string_width_1.default)(text);
          if (width > 0 && this.layout.cursor.col + width < this.tty.col && !this.shouldHighlight()) {
            this.layout.cursor.col += width;
            this.layout.end.col += width;
            this.tty.write(text);
          } else {
            this.refresh();
          }
        } else {
          this.refresh();
        }
      }
      update(text) {
        this.line.update(text, text.length);
        this.refresh();
      }
      editBackspace(n8) {
        if (this.line.backspace(n8)) {
          this.refresh();
        }
      }
      editDelete(n8) {
        if (this.line.delete(n8)) {
          this.refresh();
        }
      }
      editDeleteEndOfLine() {
        if (this.line.deleteEndOfLine()) {
          this.refresh();
        }
      }
      refresh() {
        const newLayout = this.tty.computeLayout(this.promptSize, this.line);
        this.tty.refreshLine(this.prompt, this.line, this.layout, newLayout, this.highlighter);
        this.layout = newLayout;
      }
      moveCursorBack(n8) {
        if (this.line.moveBack(n8)) {
          this.moveCursor();
        }
      }
      moveCursorForward(n8) {
        if (this.line.moveForward(n8)) {
          this.moveCursor();
        }
      }
      moveCursorUp(n8) {
        if (this.line.moveLineUp(n8)) {
          this.moveCursor();
        } else {
          this.previousHistory();
        }
      }
      moveCursorDown(n8) {
        if (this.line.moveLineDown(n8)) {
          this.moveCursor();
        } else {
          this.nextHistory();
        }
      }
      moveCursorHome() {
        if (this.line.moveHome()) {
          this.moveCursor();
        }
      }
      moveCursorEnd() {
        if (this.line.moveEnd()) {
          this.moveCursor();
        }
      }
      moveCursorToEnd() {
        if (this.layout.cursor === this.layout.end) {
          return;
        }
        this.tty.moveCursor(this.layout.cursor, this.layout.end);
        this.layout.cursor = Object.assign({}, this.layout.end);
      }
      previousHistory() {
        if (this.history.cursor === -1 && this.line.length() > 0) {
          return;
        }
        const prev = this.history.prev();
        if (prev !== void 0) {
          this.update(prev);
        }
      }
      nextHistory() {
        if (this.history.cursor === -1) {
          return;
        }
        const next = this.history.next();
        if (next !== void 0) {
          this.update(next);
        } else {
          this.update("");
        }
      }
      moveCursor() {
        const cursor = this.tty.calculatePosition(this.line.pos_buffer(), this.promptSize);
        if (cursor === this.layout.cursor) {
          return;
        }
        if (this.shouldHighlight()) {
          this.refresh();
        } else {
          this.tty.moveCursor(this.layout.cursor, cursor);
          this.layout.promptSize = Object.assign({}, this.promptSize);
          this.layout.cursor = Object.assign({}, cursor);
        }
      }
    };
    exports.State = State;
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/history.js
var require_history = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/history.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.History = void 0;
    var History = class {
      constructor(maxEntries) {
        this.entries = [];
        this.cursor = -1;
        this.maxEntries = maxEntries;
      }
      saveToLocalStorage() {
        const localStorage = window === null || window === void 0 ? void 0 : window.localStorage;
        if (localStorage !== void 0) {
          localStorage.setItem("history", JSON.stringify(this.entries));
        }
      }
      restoreFromLocalStorage() {
        const localStorage = window === null || window === void 0 ? void 0 : window.localStorage;
        if (localStorage !== void 0) {
          const historyJson = localStorage.getItem("history");
          if (historyJson === void 0 || historyJson === null) {
            return;
          }
          try {
            const historyEntries = JSON.parse(historyJson);
            if (!Array.isArray(historyEntries) || historyEntries.find((it) => typeof it !== "string") !== void 0) {
              this.entries = [];
              localStorage.setItem("history", "[]");
            } else {
              this.entries = historyEntries;
            }
          } catch (e2) {
            this.entries = [];
            localStorage.setItem("history", "[]");
          }
        }
      }
      append(text) {
        this.resetCursor();
        if (!this.entries.includes(text)) {
          this.entries.unshift(text);
        } else {
          this.entries.splice(this.entries.indexOf(text), 1);
          this.entries.unshift(text);
        }
        if (this.entries.length > this.maxEntries) {
          this.entries.pop();
        }
        this.saveToLocalStorage();
      }
      resetCursor() {
        this.cursor = -1;
      }
      next() {
        if (this.cursor === -1) {
          return void 0;
        } else {
          this.cursor -= 1;
        }
        return this.entries[this.cursor];
      }
      prev() {
        if (this.cursor + 1 >= this.entries.length) {
          return void 0;
        } else {
          this.cursor += 1;
        }
        return this.entries[this.cursor];
      }
    };
    exports.History = History;
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/tty.js
var require_tty = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/tty.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Tty = void 0;
    var string_width_1 = __importDefault(require_string_width());
    var Tty = class {
      constructor(col, row, tabWidth, out) {
        this.tabWidth = tabWidth;
        this.col = col;
        this.row = row;
        this.out = out;
      }
      write(text) {
        return this.out.write(text);
      }
      print(text) {
        return this.out.print(text);
      }
      println(text) {
        return this.out.println(text);
      }
      clearScreen() {
        this.out.write("\x1B[H\x1B[2J");
      }
      // Calculate the number of colums and rows required to print
      // text on a this.cols wide terminal starting at orig
      calculatePosition(text, orig) {
        const pos = Object.assign({}, orig);
        let escSeq = 0;
        [...text].forEach((c12) => {
          if (c12 === "\n") {
            pos.row += 1;
            pos.col = 0;
            return;
          }
          let cw = 0;
          if (c12 === "	") {
            cw = this.tabWidth - pos.col % this.tabWidth;
          } else {
            let size;
            [size, escSeq] = width(c12, escSeq);
            cw = size;
          }
          pos.col += cw;
          if (pos.col > this.col) {
            pos.row += 1;
            pos.col = cw;
          }
        });
        if (pos.col === this.col) {
          pos.col = 0;
          pos.row += 1;
        }
        return pos;
      }
      computeLayout(promptSize, line) {
        const newPromptSize = Object.assign({}, promptSize);
        const pos = line.pos;
        const cursor = this.calculatePosition(line.buf.slice(0, line.pos), promptSize);
        const end = pos === line.buf.length ? Object.assign({}, cursor) : this.calculatePosition(line.buf.slice(pos), cursor);
        const newLayout = {
          promptSize: newPromptSize,
          cursor,
          end
        };
        return newLayout;
      }
      refreshLine(prompt, line, oldLayout, newLayout, highlighter) {
        const cursor = newLayout.cursor;
        const endPos = newLayout.end;
        this.clearOldRows(oldLayout);
        this.write(highlighter.highlightPrompt(prompt));
        this.write(highlighter.highlight(line.buf, line.pos));
        if (endPos.col === 0 && endPos.row > 0 && line.buf[line.buf.length - 1] !== "\n") {
          this.write("\n");
        }
        const newCursorRowMovement = endPos.row - cursor.row;
        if (newCursorRowMovement > 0) {
          this.write(`\x1B[${newCursorRowMovement}A`);
        }
        if (cursor.col > 0) {
          this.write(`\r\x1B[${cursor.col}C`);
        } else {
          this.write("\r");
        }
      }
      clearOldRows(layout) {
        const currentRow = layout.cursor.row;
        const oldRows = layout.end.row;
        const cursorRowMovement = Math.max(oldRows - currentRow, 0);
        if (cursorRowMovement > 0) {
          this.write(`\x1B[${cursorRowMovement}B`);
        }
        for (let i7 = 0; i7 < oldRows; i7++) {
          this.write("\r\x1B[0K\x1B[A");
        }
        this.write("\r\x1B[0K");
      }
      moveCursor(oldCursor, newCursor) {
        if (newCursor.row > oldCursor.row) {
          const rowShift = newCursor.row - oldCursor.row;
          if (rowShift === 1) {
            this.write("\x1B[B");
          } else {
            this.write(`\x1B[${rowShift}B`);
          }
        } else if (newCursor.row < oldCursor.row) {
          const rowShift = oldCursor.row - newCursor.row;
          if (rowShift === 1) {
            this.write("\x1B[A");
          } else {
            this.write(`\x1B[${rowShift}A`);
          }
        }
        if (newCursor.col > oldCursor.col) {
          const colShift = newCursor.col - oldCursor.col;
          if (colShift === 1) {
            this.write("\x1B[C");
          } else {
            this.write(`\x1B[${colShift}C`);
          }
        } else if (newCursor.col < oldCursor.col) {
          const colShift = oldCursor.col - newCursor.col;
          if (colShift === 1) {
            this.write("\x1B[D");
          } else {
            this.write(`\x1B[${colShift}D`);
          }
        }
        return;
      }
    };
    exports.Tty = Tty;
    function width(text, escSeq) {
      if (escSeq === 1) {
        if (text === "[") {
          return [0, 2];
        } else {
          return [0, 0];
        }
      } else if (escSeq === 2) {
        if (!(text === ";" || text[0] >= "0" && text[0] <= "9")) {
          return [0, 0];
        }
        return [0, escSeq];
      } else if (text === "\x1B") {
        return [0, 1];
      } else if (text === "\n") {
        return [0, escSeq];
      } else {
        return [(0, string_width_1.default)(text), escSeq];
      }
    }
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/highlight.js
var require_highlight = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/highlight.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.IdentityHighlighter = void 0;
    var IdentityHighlighter = class {
      highlight(line, pos) {
        return line;
      }
      highlightPrompt(prompt) {
        return prompt;
      }
      highlightChar(line, pos) {
        return false;
      }
    };
    exports.IdentityHighlighter = IdentityHighlighter;
  }
});

// ../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/readline.js
var require_readline = __commonJS({
  "../../node_modules/.pnpm/xterm-readline@1.1.1_xterm@5.3.0/node_modules/xterm-readline/lib/readline.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Readline = void 0;
    var keymap_1 = require_keymap();
    var state_1 = require_state();
    var history_1 = require_history();
    var tty_1 = require_tty();
    var highlight_1 = require_highlight();
    var Readline2 = class {
      constructor() {
        this.highlighter = new highlight_1.IdentityHighlighter();
        this.history = new history_1.History(50);
        this.disposables = [];
        this.watermark = 0;
        this.highWatermark = 1e4;
        this.lowWatermark = 1e3;
        this.highWater = false;
        this.state = new state_1.State(">", this.tty(), this.highlighter, this.history);
        this.checkHandler = () => true;
        this.ctrlCHandler = () => {
          return;
        };
        this.pauseHandler = (resume) => {
          return;
        };
        this.history.restoreFromLocalStorage();
      }
      /**
       * Activate this addon - this function is called by xterm's
       * loadAddon().
       *
       * @param term - The terminal this readline is attached to.
       */
      activate(term2) {
        this.term = term2;
        this.term.onData(this.readData.bind(this));
        this.term.attachCustomKeyEventHandler(this.handleKeyEvent.bind(this));
      }
      /**
       * Dispose
       *
       */
      dispose() {
        this.disposables.forEach((d7) => d7.dispose());
      }
      /**
       * Manually append a line to the top of the readline's history.
       *
       * @param text - The text to append to history.
       */
      appendHistory(text) {
        this.history.append(text);
      }
      /**
       * Set the highlighter handler for this readline. This is used to
       * create custom highlighting functionality (e.g. for syntax highlighting
       * or bracket matching).
       *
       * @param highlighter - A handler to handle all highlight callbacks.
       */
      setHighlighter(highlighter) {
        this.highlighter = highlighter;
      }
      /**
       * Set the check callback. This callback is used by readline to determine if input
       * requires additiona lines when the user presses 'enter'.
       *
       * @param fn - A function (string) -> boolean that should return true if the input
       *             is complete, and false if a line (\n) should be added to the input.
       */
      setCheckHandler(fn) {
        this.checkHandler = fn;
      }
      /**
       * Set the ctrl-c handler. This function will be called if ctrl-c is encountered
       * between readline reads. This may be used in circumstances where input from the
       * user may result in a long running task that can be cancelled.
       *
       * @param fn - The ctrl-c handler.
       */
      setCtrlCHandler(fn) {
        this.ctrlCHandler = fn;
      }
      /**
       * Set the callback to be called when the user presses ctrl-s/ctrl-q.
       *
       * @param fn - The pause handler
       */
      setPauseHandler(fn) {
        this.pauseHandler = fn;
      }
      /**
       * writeReady() may be used to implement basic output flow control. This function
       * will return false if the writes to the terminal initiated by Readline have
       * reached a highwater mark.
       *
       * @returns true if this terminal is accepting more input.
       */
      writeReady() {
        return !this.highWater;
      }
      /**
       * Write text to the terminal.
       *
       * @param text - The text to write to the terminal.
       */
      write(text) {
        if (text === "\n") {
          text = "\r\n";
        } else {
          text = text.replace(/^\n/, "\r\n");
          text = text.replace(/([^\r])\n/g, "$1\r\n");
        }
        const outputLength = text.length;
        this.watermark += outputLength;
        if (this.watermark > this.highWatermark) {
          this.highWater = true;
        }
        if (this.term) {
          this.term.write(text, () => {
            this.watermark = Math.max(this.watermark - outputLength, 0);
            if (this.highWater && this.watermark < this.lowWatermark) {
              this.highWater = false;
            }
          });
        }
      }
      /**
       * Write text to the terminal.
       *
       * @param text - The text to write to the terminal
       */
      print(text) {
        return this.write(text);
      }
      /**
       * Write text to the terminal and append with "\r\n".
       *
       * @param text - The text to write to the terminal./
       * @returns
       */
      println(text) {
        return this.write(text + "\r\n");
      }
      /**
       * Obtain an output interface to this terminal.
       *
       * @returns Output
       */
      output() {
        return this;
      }
      /**
       * Obtain a tty interface to this terminal.
       *
       * @returns A tty
       */
      tty() {
        var _a, _b;
        if (((_b = (_a = this.term) === null || _a === void 0 ? void 0 : _a.options) === null || _b === void 0 ? void 0 : _b.tabStopWidth) !== void 0) {
          return new tty_1.Tty(this.term.cols, this.term.rows, this.term.options.tabStopWidth, this.output());
        } else {
          return new tty_1.Tty(0, 0, 8, this.output());
        }
      }
      /**
       * Display the given prompt and wait for one line of input from the
       * terminal. The returned promise will be executed when a line has been
       * read from the terminal.
       *
       * @param prompt The prompt to use.
       * @returns A promise to be called when the input has been read.
       */
      read(prompt) {
        return new Promise((resolve, reject) => {
          if (this.term === void 0) {
            reject("addon is not active");
            return;
          }
          this.state = new state_1.State(prompt, this.tty(), this.highlighter, this.history);
          this.state.refresh();
          this.activeRead = { prompt, resolve, reject };
        });
      }
      handleKeyEvent(event) {
        if (event.key === "Enter" && event.shiftKey) {
          if (event.type === "keydown") {
            this.readKey({
              inputType: keymap_1.InputType.ShiftEnter,
              data: ["\r"]
            });
          }
          return false;
        }
        return true;
      }
      readData(data) {
        const input = (0, keymap_1.parseInput)(data);
        if (input.length > 1 || input[0].inputType === keymap_1.InputType.Text && input[0].data.length > 1) {
          this.readPaste(input);
          return;
        }
        this.readKey(input[0]);
      }
      readPaste(input) {
        const mappedInput = input.map((it) => {
          if (it.inputType === keymap_1.InputType.Enter) {
            return { inputType: keymap_1.InputType.Text, data: ["\n"] };
          }
          return it;
        });
        for (const it of mappedInput) {
          if (it.inputType === keymap_1.InputType.Text) {
            this.state.editInsert(it.data.join(""));
          } else {
            this.readKey(it);
          }
        }
      }
      readKey(input) {
        var _a, _b, _c;
        if (this.activeRead === void 0) {
          switch (input.inputType) {
            case keymap_1.InputType.CtrlC:
              this.ctrlCHandler();
              break;
            case keymap_1.InputType.CtrlL:
              this.write("\x1B[H\x1B[2J");
              break;
          }
          return;
        }
        switch (input.inputType) {
          case keymap_1.InputType.Text:
            this.state.editInsert(input.data.join(""));
            break;
          case keymap_1.InputType.AltEnter:
          case keymap_1.InputType.ShiftEnter:
            this.state.editInsert("\n");
            break;
          case keymap_1.InputType.Enter:
            if (this.checkHandler(this.state.buffer())) {
              this.state.moveCursorToEnd();
              (_a = this.term) === null || _a === void 0 ? void 0 : _a.write("\r\n");
              this.history.append(this.state.buffer());
              (_b = this.activeRead) === null || _b === void 0 ? void 0 : _b.resolve(this.state.buffer());
              this.activeRead = void 0;
            } else {
              this.state.editInsert("\n");
            }
            break;
          case keymap_1.InputType.CtrlC:
            this.state.moveCursorToEnd();
            (_c = this.term) === null || _c === void 0 ? void 0 : _c.write("^C\r\n");
            this.state = new state_1.State(this.activeRead.prompt, this.tty(), this.highlighter, this.history);
            this.state.refresh();
            break;
          case keymap_1.InputType.CtrlS:
            this.pauseHandler(false);
            break;
          case keymap_1.InputType.CtrlU:
            this.state.update("");
            break;
          case keymap_1.InputType.CtrlK:
            this.state.editDeleteEndOfLine();
            break;
          case keymap_1.InputType.CtrlQ:
            this.pauseHandler(true);
            break;
          case keymap_1.InputType.CtrlL:
            this.state.clearScreen();
            break;
          case keymap_1.InputType.Home:
          case keymap_1.InputType.CtrlA:
            this.state.moveCursorHome();
            break;
          case keymap_1.InputType.End:
          case keymap_1.InputType.CtrlE:
            this.state.moveCursorEnd();
            break;
          case keymap_1.InputType.Backspace:
            this.state.editBackspace(1);
            break;
          case keymap_1.InputType.Delete:
          case keymap_1.InputType.CtrlD:
            this.state.editDelete(1);
            break;
          case keymap_1.InputType.ArrowLeft:
            this.state.moveCursorBack(1);
            break;
          case keymap_1.InputType.ArrowRight:
            this.state.moveCursorForward(1);
            break;
          case keymap_1.InputType.ArrowUp:
            this.state.moveCursorUp(1);
            break;
          case keymap_1.InputType.ArrowDown:
            this.state.moveCursorDown(1);
            break;
          case keymap_1.InputType.UnsupportedControlChar:
          case keymap_1.InputType.UnsupportedEscape:
            break;
        }
      }
    };
    exports.Readline = Readline2;
  }
});

// src/debug.ts
var import_xterm = __toESM(require_xterm());
var import_xterm_addon_fit = __toESM(require_xterm_addon_fit());
var import_xterm_readline = __toESM(require_readline());

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-FEIY7W7S.js
var d = Object.defineProperty;
var e = (c12, a8) => {
  for (var b4 in a8)
    d(c12, b4, { get: a8[b4], enumerable: true });
};

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-5UWJICAP.js
var w = {};
e(w, { convertFileSrc: () => u, invoke: () => d2, transformCallback: () => s });
function l() {
  return window.crypto.getRandomValues(new Uint32Array(1))[0];
}
function s(r4, n8 = false) {
  let e2 = l(), t5 = `_${e2}`;
  return Object.defineProperty(window, t5, { value: (o5) => (n8 && Reflect.deleteProperty(window, t5), r4?.(o5)), writable: false, configurable: true }), e2;
}
async function d2(r4, n8 = {}) {
  return new Promise((e2, t5) => {
    let o5 = s((i7) => {
      e2(i7), Reflect.deleteProperty(window, `_${a8}`);
    }, true), a8 = s((i7) => {
      t5(i7), Reflect.deleteProperty(window, `_${o5}`);
    }, true);
    window.__TAURI_IPC__({ cmd: r4, callback: o5, error: a8, ...n8 });
  });
}
function u(r4, n8 = "asset") {
  let e2 = encodeURIComponent(r4);
  return navigator.userAgent.includes("Windows") ? `https://${n8}.localhost/${e2}` : `${n8}://localhost/${e2}`;
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-RKMHWDGH.js
async function a(i7) {
  return d2("tauri", i7);
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-M3Y6ZK7U.js
var W = {};
e(W, { TauriEvent: () => c, emit: () => D, listen: () => E, once: () => _ });
async function s2(n8, t5) {
  return a({ __tauriModule: "Event", message: { cmd: "unlisten", event: n8, eventId: t5 } });
}
async function m(n8, t5, r4) {
  await a({ __tauriModule: "Event", message: { cmd: "emit", event: n8, windowLabel: t5, payload: r4 } });
}
async function a2(n8, t5, r4) {
  return a({ __tauriModule: "Event", message: { cmd: "listen", event: n8, windowLabel: t5, handler: s(r4) } }).then((i7) => async () => s2(n8, i7));
}
async function u2(n8, t5, r4) {
  return a2(n8, t5, (i7) => {
    r4(i7), s2(n8, i7.id).catch(() => {
    });
  });
}
var c = ((e2) => (e2.WINDOW_RESIZED = "tauri://resize", e2.WINDOW_MOVED = "tauri://move", e2.WINDOW_CLOSE_REQUESTED = "tauri://close-requested", e2.WINDOW_CREATED = "tauri://window-created", e2.WINDOW_DESTROYED = "tauri://destroyed", e2.WINDOW_FOCUS = "tauri://focus", e2.WINDOW_BLUR = "tauri://blur", e2.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change", e2.WINDOW_THEME_CHANGED = "tauri://theme-changed", e2.WINDOW_FILE_DROP = "tauri://file-drop", e2.WINDOW_FILE_DROP_HOVER = "tauri://file-drop-hover", e2.WINDOW_FILE_DROP_CANCELLED = "tauri://file-drop-cancelled", e2.MENU = "tauri://menu", e2.CHECK_UPDATE = "tauri://update", e2.UPDATE_AVAILABLE = "tauri://update-available", e2.INSTALL_UPDATE = "tauri://update-install", e2.STATUS_UPDATE = "tauri://update-status", e2.DOWNLOAD_PROGRESS = "tauri://update-download-progress", e2))(c || {});
async function E(n8, t5) {
  return a2(n8, null, t5);
}
async function _(n8, t5) {
  return u2(n8, null, t5);
}
async function D(n8, t5) {
  return m(n8, void 0, t5);
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-4NZJJ336.js
var l2 = {};
e(l2, { checkUpdate: () => c2, installUpdate: () => f, onUpdaterEvent: () => d3 });
async function d3(n8) {
  return E("tauri://update-status", (e2) => {
    n8(e2?.payload);
  });
}
async function f() {
  let n8;
  function e2() {
    n8 && n8(), n8 = void 0;
  }
  return new Promise((i7, r4) => {
    function o5(a8) {
      if (a8.error) {
        e2(), r4(a8.error);
        return;
      }
      a8.status === "DONE" && (e2(), i7());
    }
    d3(o5).then((a8) => {
      n8 = a8;
    }).catch((a8) => {
      throw e2(), a8;
    }), D("tauri://update-install").catch((a8) => {
      throw e2(), a8;
    });
  });
}
async function c2() {
  let n8;
  function e2() {
    n8 && n8(), n8 = void 0;
  }
  return new Promise((i7, r4) => {
    function o5(t5) {
      e2(), i7({ manifest: t5, shouldUpdate: true });
    }
    function a8(t5) {
      if (t5.error) {
        e2(), r4(t5.error);
        return;
      }
      t5.status === "UPTODATE" && (e2(), i7({ shouldUpdate: false }));
    }
    _("tauri://update-available", (t5) => {
      o5(t5?.payload);
    }).catch((t5) => {
      throw e2(), t5;
    }), d3(a8).then((t5) => {
      n8 = t5;
    }).catch((t5) => {
      throw e2(), t5;
    }), D("tauri://update").catch((t5) => {
      throw e2(), t5;
    });
  });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-NMUKSDLG.js
var S = {};
e(S, { CloseRequestedEvent: () => y, LogicalPosition: () => c3, LogicalSize: () => m2, PhysicalPosition: () => r, PhysicalSize: () => o, UserAttentionType: () => W2, WebviewWindow: () => s3, WebviewWindowHandle: () => u3, WindowManager: () => b, appWindow: () => g, availableMonitors: () => D2, currentMonitor: () => C, getAll: () => h, getCurrent: () => E2, primaryMonitor: () => T });
var m2 = class {
  constructor(e2, a8) {
    this.type = "Logical";
    this.width = e2, this.height = a8;
  }
};
var o = class {
  constructor(e2, a8) {
    this.type = "Physical";
    this.width = e2, this.height = a8;
  }
  toLogical(e2) {
    return new m2(this.width / e2, this.height / e2);
  }
};
var c3 = class {
  constructor(e2, a8) {
    this.type = "Logical";
    this.x = e2, this.y = a8;
  }
};
var r = class {
  constructor(e2, a8) {
    this.type = "Physical";
    this.x = e2, this.y = a8;
  }
  toLogical(e2) {
    return new c3(this.x / e2, this.y / e2);
  }
};
var W2 = ((a8) => (a8[a8.Critical = 1] = "Critical", a8[a8.Informational = 2] = "Informational", a8))(W2 || {});
function E2() {
  return new s3(window.__TAURI_METADATA__.__currentWindow.label, { skip: true });
}
function h() {
  return window.__TAURI_METADATA__.__windows.map((t5) => new s3(t5.label, { skip: true }));
}
var M = ["tauri://created", "tauri://error"];
var u3 = class {
  constructor(e2) {
    this.label = e2, this.listeners = /* @__PURE__ */ Object.create(null);
  }
  async listen(e2, a8) {
    return this._handleTauriEvent(e2, a8) ? Promise.resolve(() => {
      let n8 = this.listeners[e2];
      n8.splice(n8.indexOf(a8), 1);
    }) : a2(e2, this.label, a8);
  }
  async once(e2, a8) {
    return this._handleTauriEvent(e2, a8) ? Promise.resolve(() => {
      let n8 = this.listeners[e2];
      n8.splice(n8.indexOf(a8), 1);
    }) : u2(e2, this.label, a8);
  }
  async emit(e2, a8) {
    if (M.includes(e2)) {
      for (let n8 of this.listeners[e2] || [])
        n8({ event: e2, id: -1, windowLabel: this.label, payload: a8 });
      return Promise.resolve();
    }
    return m(e2, this.label, a8);
  }
  _handleTauriEvent(e2, a8) {
    return M.includes(e2) ? (e2 in this.listeners ? this.listeners[e2].push(a8) : this.listeners[e2] = [a8], true) : false;
  }
};
var b = class extends u3 {
  async scaleFactor() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "scaleFactor" } } } });
  }
  async innerPosition() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "innerPosition" } } } }).then(({ x: e2, y: a8 }) => new r(e2, a8));
  }
  async outerPosition() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "outerPosition" } } } }).then(({ x: e2, y: a8 }) => new r(e2, a8));
  }
  async innerSize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "innerSize" } } } }).then(({ width: e2, height: a8 }) => new o(e2, a8));
  }
  async outerSize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "outerSize" } } } }).then(({ width: e2, height: a8 }) => new o(e2, a8));
  }
  async isFullscreen() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isFullscreen" } } } });
  }
  async isMinimized() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isMinimized" } } } });
  }
  async isMaximized() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isMaximized" } } } });
  }
  async isFocused() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isFocused" } } } });
  }
  async isDecorated() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isDecorated" } } } });
  }
  async isResizable() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isResizable" } } } });
  }
  async isMaximizable() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isMaximizable" } } } });
  }
  async isMinimizable() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isMinimizable" } } } });
  }
  async isClosable() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isClosable" } } } });
  }
  async isVisible() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "isVisible" } } } });
  }
  async title() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "title" } } } });
  }
  async theme() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "theme" } } } });
  }
  async center() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "center" } } } });
  }
  async requestUserAttention(e2) {
    let a8 = null;
    return e2 && (e2 === 1 ? a8 = { type: "Critical" } : a8 = { type: "Informational" }), a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "requestUserAttention", payload: a8 } } } });
  }
  async setResizable(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setResizable", payload: e2 } } } });
  }
  async setMaximizable(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setMaximizable", payload: e2 } } } });
  }
  async setMinimizable(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setMinimizable", payload: e2 } } } });
  }
  async setClosable(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setClosable", payload: e2 } } } });
  }
  async setTitle(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setTitle", payload: e2 } } } });
  }
  async maximize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "maximize" } } } });
  }
  async unmaximize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "unmaximize" } } } });
  }
  async toggleMaximize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "toggleMaximize" } } } });
  }
  async minimize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "minimize" } } } });
  }
  async unminimize() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "unminimize" } } } });
  }
  async show() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "show" } } } });
  }
  async hide() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "hide" } } } });
  }
  async close() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "close" } } } });
  }
  async setDecorations(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setDecorations", payload: e2 } } } });
  }
  async setAlwaysOnTop(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setAlwaysOnTop", payload: e2 } } } });
  }
  async setContentProtected(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setContentProtected", payload: e2 } } } });
  }
  async setSize(e2) {
    if (!e2 || e2.type !== "Logical" && e2.type !== "Physical")
      throw new Error("the `size` argument must be either a LogicalSize or a PhysicalSize instance");
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setSize", payload: { type: e2.type, data: { width: e2.width, height: e2.height } } } } } });
  }
  async setMinSize(e2) {
    if (e2 && e2.type !== "Logical" && e2.type !== "Physical")
      throw new Error("the `size` argument must be either a LogicalSize or a PhysicalSize instance");
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setMinSize", payload: e2 ? { type: e2.type, data: { width: e2.width, height: e2.height } } : null } } } });
  }
  async setMaxSize(e2) {
    if (e2 && e2.type !== "Logical" && e2.type !== "Physical")
      throw new Error("the `size` argument must be either a LogicalSize or a PhysicalSize instance");
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setMaxSize", payload: e2 ? { type: e2.type, data: { width: e2.width, height: e2.height } } : null } } } });
  }
  async setPosition(e2) {
    if (!e2 || e2.type !== "Logical" && e2.type !== "Physical")
      throw new Error("the `position` argument must be either a LogicalPosition or a PhysicalPosition instance");
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setPosition", payload: { type: e2.type, data: { x: e2.x, y: e2.y } } } } } });
  }
  async setFullscreen(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setFullscreen", payload: e2 } } } });
  }
  async setFocus() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setFocus" } } } });
  }
  async setIcon(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setIcon", payload: { icon: typeof e2 == "string" ? e2 : Array.from(e2) } } } } });
  }
  async setSkipTaskbar(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setSkipTaskbar", payload: e2 } } } });
  }
  async setCursorGrab(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setCursorGrab", payload: e2 } } } });
  }
  async setCursorVisible(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setCursorVisible", payload: e2 } } } });
  }
  async setCursorIcon(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setCursorIcon", payload: e2 } } } });
  }
  async setCursorPosition(e2) {
    if (!e2 || e2.type !== "Logical" && e2.type !== "Physical")
      throw new Error("the `position` argument must be either a LogicalPosition or a PhysicalPosition instance");
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setCursorPosition", payload: { type: e2.type, data: { x: e2.x, y: e2.y } } } } } });
  }
  async setIgnoreCursorEvents(e2) {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "setIgnoreCursorEvents", payload: e2 } } } });
  }
  async startDragging() {
    return a({ __tauriModule: "Window", message: { cmd: "manage", data: { label: this.label, cmd: { type: "startDragging" } } } });
  }
  async onResized(e2) {
    return this.listen("tauri://resize", (a8) => {
      a8.payload = f2(a8.payload), e2(a8);
    });
  }
  async onMoved(e2) {
    return this.listen("tauri://move", (a8) => {
      a8.payload = v(a8.payload), e2(a8);
    });
  }
  async onCloseRequested(e2) {
    return this.listen("tauri://close-requested", (a8) => {
      let n8 = new y(a8);
      Promise.resolve(e2(n8)).then(() => {
        if (!n8.isPreventDefault())
          return this.close();
      });
    });
  }
  async onFocusChanged(e2) {
    let a8 = await this.listen("tauri://focus", (d7) => {
      e2({ ...d7, payload: true });
    }), n8 = await this.listen("tauri://blur", (d7) => {
      e2({ ...d7, payload: false });
    });
    return () => {
      a8(), n8();
    };
  }
  async onScaleChanged(e2) {
    return this.listen("tauri://scale-change", e2);
  }
  async onMenuClicked(e2) {
    return this.listen("tauri://menu", e2);
  }
  async onFileDropEvent(e2) {
    let a8 = await this.listen("tauri://file-drop", (l9) => {
      e2({ ...l9, payload: { type: "drop", paths: l9.payload } });
    }), n8 = await this.listen("tauri://file-drop-hover", (l9) => {
      e2({ ...l9, payload: { type: "hover", paths: l9.payload } });
    }), d7 = await this.listen("tauri://file-drop-cancelled", (l9) => {
      e2({ ...l9, payload: { type: "cancel" } });
    });
    return () => {
      a8(), n8(), d7();
    };
  }
  async onThemeChanged(e2) {
    return this.listen("tauri://theme-changed", e2);
  }
};
var y = class {
  constructor(e2) {
    this._preventDefault = false;
    this.event = e2.event, this.windowLabel = e2.windowLabel, this.id = e2.id;
  }
  preventDefault() {
    this._preventDefault = true;
  }
  isPreventDefault() {
    return this._preventDefault;
  }
};
var s3 = class extends b {
  constructor(e2, a8 = {}) {
    super(e2), a8?.skip || a({ __tauriModule: "Window", message: { cmd: "createWebview", data: { options: { label: e2, ...a8 } } } }).then(async () => this.emit("tauri://created")).catch(async (n8) => this.emit("tauri://error", n8));
  }
  static getByLabel(e2) {
    return h().some((a8) => a8.label === e2) ? new s3(e2, { skip: true }) : null;
  }
  static async getFocusedWindow() {
    for (let e2 of h())
      if (await e2.isFocused())
        return e2;
    return null;
  }
};
var g;
"__TAURI_METADATA__" in window ? g = new s3(window.__TAURI_METADATA__.__currentWindow.label, { skip: true }) : (console.warn(`Could not find "window.__TAURI_METADATA__". The "appWindow" value will reference the "main" window label.
Note that this is not an issue if running this frontend on a browser instead of a Tauri window.`), g = new s3("main", { skip: true }));
function p(t5) {
  return t5 === null ? null : { name: t5.name, scaleFactor: t5.scaleFactor, position: v(t5.position), size: f2(t5.size) };
}
function v(t5) {
  return new r(t5.x, t5.y);
}
function f2(t5) {
  return new o(t5.width, t5.height);
}
async function C() {
  return a({ __tauriModule: "Window", message: { cmd: "manage", data: { cmd: { type: "currentMonitor" } } } }).then(p);
}
async function T() {
  return a({ __tauriModule: "Window", message: { cmd: "manage", data: { cmd: { type: "primaryMonitor" } } } }).then(p);
}
async function D2() {
  return a({ __tauriModule: "Window", message: { cmd: "manage", data: { cmd: { type: "availableMonitors" } } } }).then((t5) => t5.map(p));
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-CICBN6X2.js
var s4 = {};
e(s4, { isPermissionGranted: () => o2, requestPermission: () => t, sendNotification: () => r2 });
async function o2() {
  return window.Notification.permission !== "default" ? Promise.resolve(window.Notification.permission === "granted") : a({ __tauriModule: "Notification", message: { cmd: "isNotificationPermissionGranted" } });
}
async function t() {
  return window.Notification.requestPermission();
}
function r2(i7) {
  typeof i7 == "string" ? new window.Notification(i7) : new window.Notification(i7.title, i7);
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-V5J25SYE.js
function n() {
  return navigator.appVersion.includes("Win");
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-2GTLV2NE.js
var u4 = {};
e(u4, { EOL: () => n2, arch: () => a3, locale: () => c4, platform: () => o3, tempdir: () => m3, type: () => t2, version: () => i });
var n2 = n() ? `\r
` : `
`;
async function o3() {
  return a({ __tauriModule: "Os", message: { cmd: "platform" } });
}
async function i() {
  return a({ __tauriModule: "Os", message: { cmd: "version" } });
}
async function t2() {
  return a({ __tauriModule: "Os", message: { cmd: "osType" } });
}
async function a3() {
  return a({ __tauriModule: "Os", message: { cmd: "arch" } });
}
async function m3() {
  return a({ __tauriModule: "Os", message: { cmd: "tempdir" } });
}
async function c4() {
  return a({ __tauriModule: "Os", message: { cmd: "locale" } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-GP2EXCRB.js
var x = {};
e(x, { BaseDirectory: () => F, Dir: () => F, copyFile: () => c5, createDir: () => d4, exists: () => v2, readBinaryFile: () => a4, readDir: () => m4, readTextFile: () => l3, removeDir: () => g2, removeFile: () => O, renameFile: () => _2, writeBinaryFile: () => f3, writeFile: () => u5, writeTextFile: () => u5 });
var F = ((n8) => (n8[n8.Audio = 1] = "Audio", n8[n8.Cache = 2] = "Cache", n8[n8.Config = 3] = "Config", n8[n8.Data = 4] = "Data", n8[n8.LocalData = 5] = "LocalData", n8[n8.Desktop = 6] = "Desktop", n8[n8.Document = 7] = "Document", n8[n8.Download = 8] = "Download", n8[n8.Executable = 9] = "Executable", n8[n8.Font = 10] = "Font", n8[n8.Home = 11] = "Home", n8[n8.Picture = 12] = "Picture", n8[n8.Public = 13] = "Public", n8[n8.Runtime = 14] = "Runtime", n8[n8.Template = 15] = "Template", n8[n8.Video = 16] = "Video", n8[n8.Resource = 17] = "Resource", n8[n8.App = 18] = "App", n8[n8.Log = 19] = "Log", n8[n8.Temp = 20] = "Temp", n8[n8.AppConfig = 21] = "AppConfig", n8[n8.AppData = 22] = "AppData", n8[n8.AppLocalData = 23] = "AppLocalData", n8[n8.AppCache = 24] = "AppCache", n8[n8.AppLog = 25] = "AppLog", n8))(F || {});
async function l3(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "readTextFile", path: i7, options: t5 } });
}
async function a4(i7, t5 = {}) {
  let s10 = await a({ __tauriModule: "Fs", message: { cmd: "readFile", path: i7, options: t5 } });
  return Uint8Array.from(s10);
}
async function u5(i7, t5, s10) {
  typeof s10 == "object" && Object.freeze(s10), typeof i7 == "object" && Object.freeze(i7);
  let e2 = { path: "", contents: "" }, r4 = s10;
  return typeof i7 == "string" ? e2.path = i7 : (e2.path = i7.path, e2.contents = i7.contents), typeof t5 == "string" ? e2.contents = t5 ?? "" : r4 = t5, a({ __tauriModule: "Fs", message: { cmd: "writeFile", path: e2.path, contents: Array.from(new TextEncoder().encode(e2.contents)), options: r4 } });
}
async function f3(i7, t5, s10) {
  typeof s10 == "object" && Object.freeze(s10), typeof i7 == "object" && Object.freeze(i7);
  let e2 = { path: "", contents: [] }, r4 = s10;
  return typeof i7 == "string" ? e2.path = i7 : (e2.path = i7.path, e2.contents = i7.contents), t5 && "dir" in t5 ? r4 = t5 : typeof i7 == "string" && (e2.contents = t5 ?? []), a({ __tauriModule: "Fs", message: { cmd: "writeFile", path: e2.path, contents: Array.from(e2.contents instanceof ArrayBuffer ? new Uint8Array(e2.contents) : e2.contents), options: r4 } });
}
async function m4(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "readDir", path: i7, options: t5 } });
}
async function d4(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "createDir", path: i7, options: t5 } });
}
async function g2(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "removeDir", path: i7, options: t5 } });
}
async function c5(i7, t5, s10 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "copyFile", source: i7, destination: t5, options: s10 } });
}
async function O(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "removeFile", path: i7, options: t5 } });
}
async function _2(i7, t5, s10 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "renameFile", oldPath: i7, newPath: t5, options: s10 } });
}
async function v2(i7, t5 = {}) {
  return a({ __tauriModule: "Fs", message: { cmd: "exists", path: i7, options: t5 } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-PEDMYRP6.js
var q = {};
e(q, { BaseDirectory: () => F, appCacheDir: () => g3, appConfigDir: () => s5, appDataDir: () => c6, appDir: () => u6, appLocalDataDir: () => m5, appLogDir: () => n3, audioDir: () => d5, basename: () => V, cacheDir: () => P, configDir: () => h2, dataDir: () => l4, delimiter: () => z, desktopDir: () => _3, dirname: () => F2, documentDir: () => p2, downloadDir: () => y2, executableDir: () => f4, extname: () => H, fontDir: () => D3, homeDir: () => M2, isAbsolute: () => W3, join: () => E3, localDataDir: () => v3, logDir: () => w2, normalize: () => B, pictureDir: () => b2, publicDir: () => A, resolve: () => T2, resolveResource: () => x2, resourceDir: () => C2, runtimeDir: () => L, sep: () => j, templateDir: () => R, videoDir: () => k });
async function u6() {
  return s5();
}
async function s5() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 21 } });
}
async function c6() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 22 } });
}
async function m5() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 23 } });
}
async function g3() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 24 } });
}
async function d5() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 1 } });
}
async function P() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 2 } });
}
async function h2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 3 } });
}
async function l4() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 4 } });
}
async function _3() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 6 } });
}
async function p2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 7 } });
}
async function y2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 8 } });
}
async function f4() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 9 } });
}
async function D3() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 10 } });
}
async function M2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 11 } });
}
async function v3() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 5 } });
}
async function b2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 12 } });
}
async function A() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 13 } });
}
async function C2() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 17 } });
}
async function x2(t5) {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: t5, directory: 17 } });
}
async function L() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 14 } });
}
async function R() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 15 } });
}
async function k() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 16 } });
}
async function w2() {
  return n3();
}
async function n3() {
  return a({ __tauriModule: "Path", message: { cmd: "resolvePath", path: "", directory: 25 } });
}
var j = n() ? "\\" : "/";
var z = n() ? ";" : ":";
async function T2(...t5) {
  return a({ __tauriModule: "Path", message: { cmd: "resolve", paths: t5 } });
}
async function B(t5) {
  return a({ __tauriModule: "Path", message: { cmd: "normalize", path: t5 } });
}
async function E3(...t5) {
  return a({ __tauriModule: "Path", message: { cmd: "join", paths: t5 } });
}
async function F2(t5) {
  return a({ __tauriModule: "Path", message: { cmd: "dirname", path: t5 } });
}
async function H(t5) {
  return a({ __tauriModule: "Path", message: { cmd: "extname", path: t5 } });
}
async function V(t5, a8) {
  return a({ __tauriModule: "Path", message: { cmd: "basename", path: t5, ext: a8 } });
}
async function W3(t5) {
  return a({ __tauriModule: "Path", message: { cmd: "isAbsolute", path: t5 } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-3O263AOJ.js
var s6 = {};
e(s6, { exit: () => i2, relaunch: () => n4 });
async function i2(r4 = 0) {
  return a({ __tauriModule: "Process", message: { cmd: "exit", exitCode: r4 } });
}
async function n4() {
  return a({ __tauriModule: "Process", message: { cmd: "relaunch" } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-6XWZL67Z.js
var m6 = {};
e(m6, { Child: () => c7, Command: () => l5, EventEmitter: () => i3, open: () => g4 });
async function p3(o5, e2, t5 = [], r4) {
  return typeof t5 == "object" && Object.freeze(t5), a({ __tauriModule: "Shell", message: { cmd: "execute", program: e2, args: t5, options: r4, onEventFn: s(o5) } });
}
var i3 = class {
  constructor() {
    this.eventListeners = /* @__PURE__ */ Object.create(null);
  }
  addListener(e2, t5) {
    return this.on(e2, t5);
  }
  removeListener(e2, t5) {
    return this.off(e2, t5);
  }
  on(e2, t5) {
    return e2 in this.eventListeners ? this.eventListeners[e2].push(t5) : this.eventListeners[e2] = [t5], this;
  }
  once(e2, t5) {
    let r4 = (...s10) => {
      this.removeListener(e2, r4), t5(...s10);
    };
    return this.addListener(e2, r4);
  }
  off(e2, t5) {
    return e2 in this.eventListeners && (this.eventListeners[e2] = this.eventListeners[e2].filter((r4) => r4 !== t5)), this;
  }
  removeAllListeners(e2) {
    return e2 ? delete this.eventListeners[e2] : this.eventListeners = /* @__PURE__ */ Object.create(null), this;
  }
  emit(e2, ...t5) {
    if (e2 in this.eventListeners) {
      let r4 = this.eventListeners[e2];
      for (let s10 of r4)
        s10(...t5);
      return true;
    }
    return false;
  }
  listenerCount(e2) {
    return e2 in this.eventListeners ? this.eventListeners[e2].length : 0;
  }
  prependListener(e2, t5) {
    return e2 in this.eventListeners ? this.eventListeners[e2].unshift(t5) : this.eventListeners[e2] = [t5], this;
  }
  prependOnceListener(e2, t5) {
    let r4 = (...s10) => {
      this.removeListener(e2, r4), t5(...s10);
    };
    return this.prependListener(e2, r4);
  }
};
var c7 = class {
  constructor(e2) {
    this.pid = e2;
  }
  async write(e2) {
    return a({ __tauriModule: "Shell", message: { cmd: "stdinWrite", pid: this.pid, buffer: typeof e2 == "string" ? e2 : Array.from(e2) } });
  }
  async kill() {
    return a({ __tauriModule: "Shell", message: { cmd: "killChild", pid: this.pid } });
  }
};
var l5 = class extends i3 {
  constructor(t5, r4 = [], s10) {
    super();
    this.stdout = new i3();
    this.stderr = new i3();
    this.program = t5, this.args = typeof r4 == "string" ? [r4] : r4, this.options = s10 ?? {};
  }
  static sidecar(t5, r4 = [], s10) {
    let a8 = new l5(t5, r4, s10);
    return a8.options.sidecar = true, a8;
  }
  async spawn() {
    return p3((t5) => {
      switch (t5.event) {
        case "Error":
          this.emit("error", t5.payload);
          break;
        case "Terminated":
          this.emit("close", t5.payload);
          break;
        case "Stdout":
          this.stdout.emit("data", t5.payload);
          break;
        case "Stderr":
          this.stderr.emit("data", t5.payload);
          break;
      }
    }, this.program, this.args, this.options).then((t5) => new c7(t5));
  }
  async execute() {
    return new Promise((t5, r4) => {
      this.on("error", r4);
      let s10 = [], a8 = [];
      this.stdout.on("data", (n8) => {
        s10.push(n8);
      }), this.stderr.on("data", (n8) => {
        a8.push(n8);
      }), this.on("close", (n8) => {
        t5({ code: n8.code, signal: n8.signal, stdout: s10.join(`
`), stderr: a8.join(`
`) });
      }), this.spawn().catch(r4);
    });
  }
};
async function g4(o5, e2) {
  return a({ __tauriModule: "Shell", message: { cmd: "open", path: o5, with: e2 } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-DIFM6EX4.js
var u7 = {};
e(u7, { getName: () => n5, getTauriVersion: () => s7, getVersion: () => i4, hide: () => t3, show: () => o4 });
async function i4() {
  return a({ __tauriModule: "App", message: { cmd: "getAppVersion" } });
}
async function n5() {
  return a({ __tauriModule: "App", message: { cmd: "getAppName" } });
}
async function s7() {
  return a({ __tauriModule: "App", message: { cmd: "getTauriVersion" } });
}
async function o4() {
  return a({ __tauriModule: "App", message: { cmd: "show" } });
}
async function t3() {
  return a({ __tauriModule: "App", message: { cmd: "hide" } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-6IDLE7HB.js
var t4 = {};
e(t4, { getMatches: () => c8 });
async function c8() {
  return a({ __tauriModule: "Cli", message: { cmd: "cliMatches" } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-6PDK3LJA.js
var n6 = {};
e(n6, { readText: () => i5, writeText: () => a5 });
async function a5(r4) {
  return a({ __tauriModule: "Clipboard", message: { cmd: "writeText", data: r4 } });
}
async function i5() {
  return a({ __tauriModule: "Clipboard", message: { cmd: "readText", data: null } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-WJKH4UU7.js
var c9 = {};
e(c9, { ask: () => l6, confirm: () => g5, message: () => s8, open: () => a6, save: () => r3 });
async function a6(t5 = {}) {
  return typeof t5 == "object" && Object.freeze(t5), a({ __tauriModule: "Dialog", message: { cmd: "openDialog", options: t5 } });
}
async function r3(t5 = {}) {
  return typeof t5 == "object" && Object.freeze(t5), a({ __tauriModule: "Dialog", message: { cmd: "saveDialog", options: t5 } });
}
async function s8(t5, i7) {
  let e2 = typeof i7 == "string" ? { title: i7 } : i7;
  return a({ __tauriModule: "Dialog", message: { cmd: "messageDialog", message: t5.toString(), title: e2?.title?.toString(), type: e2?.type, buttonLabel: e2?.okLabel?.toString() } });
}
async function l6(t5, i7) {
  let e2 = typeof i7 == "string" ? { title: i7 } : i7;
  return a({ __tauriModule: "Dialog", message: { cmd: "askDialog", message: t5.toString(), title: e2?.title?.toString(), type: e2?.type, buttonLabels: [e2?.okLabel?.toString() ?? "Yes", e2?.cancelLabel?.toString() ?? "No"] } });
}
async function g5(t5, i7) {
  let e2 = typeof i7 == "string" ? { title: i7 } : i7;
  return a({ __tauriModule: "Dialog", message: { cmd: "confirmDialog", message: t5.toString(), title: e2?.title?.toString(), type: e2?.type, buttonLabels: [e2?.okLabel?.toString() ?? "Ok", e2?.cancelLabel?.toString() ?? "Cancel"] } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-ITP3W3MJ.js
var c10 = {};
e(c10, { isRegistered: () => u8, register: () => s9, registerAll: () => n7, unregister: () => a7, unregisterAll: () => l7 });
async function s9(r4, t5) {
  return a({ __tauriModule: "GlobalShortcut", message: { cmd: "register", shortcut: r4, handler: s(t5) } });
}
async function n7(r4, t5) {
  return a({ __tauriModule: "GlobalShortcut", message: { cmd: "registerAll", shortcuts: r4, handler: s(t5) } });
}
async function u8(r4) {
  return a({ __tauriModule: "GlobalShortcut", message: { cmd: "isRegistered", shortcut: r4 } });
}
async function a7(r4) {
  return a({ __tauriModule: "GlobalShortcut", message: { cmd: "unregister", shortcut: r4 } });
}
async function l7() {
  return a({ __tauriModule: "GlobalShortcut", message: { cmd: "unregisterAll" } });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/chunk-XH7VLPQH.js
var T3 = {};
e(T3, { Body: () => i6, Client: () => p4, Response: () => m7, ResponseType: () => c11, fetch: () => y3, getClient: () => d6 });
var c11 = ((s10) => (s10[s10.JSON = 1] = "JSON", s10[s10.Text = 2] = "Text", s10[s10.Binary = 3] = "Binary", s10))(c11 || {});
var i6 = class {
  constructor(e2, r4) {
    this.type = e2, this.payload = r4;
  }
  static form(e2) {
    let r4 = {}, s10 = (n8, t5) => {
      if (t5 !== null) {
        let a8;
        typeof t5 == "string" ? a8 = t5 : t5 instanceof Uint8Array || Array.isArray(t5) ? a8 = Array.from(t5) : t5 instanceof File ? a8 = { file: t5.name, mime: t5.type, fileName: t5.name } : typeof t5.file == "string" ? a8 = { file: t5.file, mime: t5.mime, fileName: t5.fileName } : a8 = { file: Array.from(t5.file), mime: t5.mime, fileName: t5.fileName }, r4[String(n8)] = a8;
      }
    };
    if (e2 instanceof FormData)
      for (let [n8, t5] of e2)
        s10(n8, t5);
    else
      for (let [n8, t5] of Object.entries(e2))
        s10(n8, t5);
    return new i6("Form", r4);
  }
  static json(e2) {
    return new i6("Json", e2);
  }
  static text(e2) {
    return new i6("Text", e2);
  }
  static bytes(e2) {
    return new i6("Bytes", Array.from(e2 instanceof ArrayBuffer ? new Uint8Array(e2) : e2));
  }
};
var m7 = class {
  constructor(e2) {
    this.url = e2.url, this.status = e2.status, this.ok = this.status >= 200 && this.status < 300, this.headers = e2.headers, this.rawHeaders = e2.rawHeaders, this.data = e2.data;
  }
};
var p4 = class {
  constructor(e2) {
    this.id = e2;
  }
  async drop() {
    return a({ __tauriModule: "Http", message: { cmd: "dropClient", client: this.id } });
  }
  async request(e2) {
    let r4 = !e2.responseType || e2.responseType === 1;
    return r4 && (e2.responseType = 2), a({ __tauriModule: "Http", message: { cmd: "httpRequest", client: this.id, options: e2 } }).then((s10) => {
      let n8 = new m7(s10);
      if (r4) {
        try {
          n8.data = JSON.parse(n8.data);
        } catch (t5) {
          if (n8.ok && n8.data === "")
            n8.data = {};
          else if (n8.ok)
            throw Error(`Failed to parse response \`${n8.data}\` as JSON: ${t5};
              try setting the \`responseType\` option to \`ResponseType.Text\` or \`ResponseType.Binary\` if the API does not return a JSON response.`);
        }
        return n8;
      }
      return n8;
    });
  }
  async get(e2, r4) {
    return this.request({ method: "GET", url: e2, ...r4 });
  }
  async post(e2, r4, s10) {
    return this.request({ method: "POST", url: e2, body: r4, ...s10 });
  }
  async put(e2, r4, s10) {
    return this.request({ method: "PUT", url: e2, body: r4, ...s10 });
  }
  async patch(e2, r4) {
    return this.request({ method: "PATCH", url: e2, ...r4 });
  }
  async delete(e2, r4) {
    return this.request({ method: "DELETE", url: e2, ...r4 });
  }
};
async function d6(o5) {
  return a({ __tauriModule: "Http", message: { cmd: "createClient", options: o5 } }).then((e2) => new p4(e2));
}
var l8 = null;
async function y3(o5, e2) {
  return l8 === null && (l8 = await d6()), l8.request({ url: o5, method: e2?.method ?? "GET", ...e2 });
}

// ../../node_modules/.pnpm/@tauri-apps+api@1.4.0/node_modules/@tauri-apps/api/index.js
var b3 = d2;

// src/debug.ts
var terminalElement = document.getElementById("terminal");
var fitAddon = new import_xterm_addon_fit.FitAddon();
var rl = new import_xterm_readline.Readline();
var term = new import_xterm.Terminal({
  // fontFamily: "Jetbrains Mono",
  // theme: {
  // background: "rgb(47, 47, 47)",
  // }
  theme: {
    background: "#191A19",
    foreground: "#F5F2E7"
  },
  cursorBlink: true,
  cursorStyle: "block"
});
term.loadAddon(fitAddon);
term.loadAddon(rl);
term.open(terminalElement);
function fitTerminal() {
  fitAddon.fit();
  void b3("async_resize_pty", {
    rows: term.rows,
    cols: term.cols
  });
}
function writeToTerminal(ev) {
  term.write(ev.payload);
}
addEventListener("resize", fitTerminal);
E("data", writeToTerminal);
fitTerminal();
rl.setCheckHandler((text) => {
  return !text.trimEnd().endsWith("&&");
});
function readLine() {
  rl.read("postgres>").then(processLine);
}
async function processLine(data) {
  b3("send_recv_postgres_terminal", { data }).then((message) => rl.println(String(message)));
  setTimeout(readLine);
}
readLine();
//# sourceMappingURL=debug.js.map
