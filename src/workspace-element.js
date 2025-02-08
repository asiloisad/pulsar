'use strict';

const ipcHelpers = require('./ipc-helpers');
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs-plus');
const { CompositeDisposable, Disposable } = require('event-kit');
const _ = require('underscore-plus');

// Asks for the current scrollbar style, then subscribes to a handler so it can
// be notified of further changes. Returns a `Disposable`.
function observeScrollbarStyle(callback) {
  // We want to act like `atom.config.observe`: set up a change handler, but
  // immediately invoke the callback with the current value as well. Since the
  // main process knows the answer here, we've got to go async.
  ipcRenderer.invoke('getScrollbarStyle').then((value) => {
    if (value) callback(value);
  });
  let result = ipcHelpers.on(
    ipcRenderer,
    'did-change-scrollbar-style',
    (_, style) => callback(style)
  );
  return result;
}

class WorkspaceElement extends HTMLElement {
  connectedCallback() {
    this.focus();
    this.htmlElement = document.querySelector('html');
    this.htmlElement.addEventListener('mouseleave', this.handleCenterLeave);
  }

  disconnectedCallback() {
    this.subscriptions.dispose();
    this.htmlElement.removeEventListener('mouseleave', this.handleCenterLeave);
  }

  initializeContent() {
    this.classList.add('workspace');
    this.setAttribute('tabindex', -1);

    this.verticalAxis = document.createElement('atom-workspace-axis');
    this.verticalAxis.classList.add('vertical');

    this.horizontalAxis = document.createElement('atom-workspace-axis');
    this.horizontalAxis.classList.add('horizontal');
    this.horizontalAxis.appendChild(this.verticalAxis);

    this.appendChild(this.horizontalAxis);
  }

  observeScrollbarStyle() {
    this.subscriptions.add(
      // On macOS, this will update the styles for all `WorkspaceElement`
      // scrollbars when the user changes the “Show scroll bars…” setting in
      // System Settings.
      //
      // This event isn't emitted by the main process on other platforms, so
      // it won't do anything on Windows or Linux.
      observeScrollbarStyle((style) => {
        switch (style) {
          case 'legacy':
            this.classList.remove('scrollbars-visible-when-scrolling');
            this.classList.add('scrollbars-visible-always');
            break;
          case 'overlay':
            this.classList.remove('scrollbars-visible-always');
            this.classList.add('scrollbars-visible-when-scrolling');
            break;
          default:
            console.warn('Unrecognized value for scrollbar style:', style);
        }
      })
    );
  }

  observeTextEditorFontConfig() {
    this.updateGlobalTextEditorStyleSheet();
    this.subscriptions.add(
      this.config.onDidChange(
        'editor.fontSize',
        this.updateGlobalTextEditorStyleSheet.bind(this)
      )
    );
    this.subscriptions.add(
      this.config.onDidChange(
        'editor.fontFamily',
        this.updateGlobalTextEditorStyleSheet.bind(this)
      )
    );
    this.subscriptions.add(
      this.config.onDidChange(
        'editor.lineHeight',
        this.updateGlobalTextEditorStyleSheet.bind(this)
      )
    );
  }

  updateGlobalTextEditorStyleSheet() {
    // We multiply `editor.fontSize` by `editor.lineHeight` to determine how
    // tall our lines will be. We could just pass `editor.lineHeight` into the
    // CSS as a factor and let CSS do the math, but Chromium tends to make a
    // mess of it, with the result being occasional tiny gaps between lines.
    // (See https://github.com/pulsar-edit/pulsar/issues/1181.)
    //
    // CSS measurements often involve math that results in unusual values that
    // will not conform to the pixel grid of the hardware. (For instance:
    // there's no way to divide 20 hardware pixels evenly into a three-column
    // grid where the CSS demands that each column be the same width.) Our best
    // theory is that Chromium used to handle this internally by nudging
    // measurements to snap to the pixel grid, but that it _stopped_ doing this
    // at some point, or else moved the snapping behavior to a much later stage
    // of the rendering process.
    //
    // (See also https://johnresig.com/blog/sub-pixel-problems-in-css/, the
    // venerable post from 2008 on this problem.)
    //
    // You may think this isn't a big deal. And, indeed, if the gaps were
    // _uniform_, you'd probably be right. But it's quite distracting when the
    // gaps happen consistently on (e.g.) every fifth or sixth line — or
    // however often the rounding errors accumulate and result in a shift.
    //
    // Since it's important to us that rendering be consistent between any
    // arbitrary pair of consecutive lines, the best way around this seems to
    // be to assume the task of pixel-grid management ourselves. In this case,
    // that means we'll compute the line height ourselves while rounding to the
    // nearest device pixel; then we'll specify the editor `line-height` in CSS
    // pixels instead of a bare number. `editor.lineHeight` accepts a broad
    // range of potential values, so we can't do this in 100% of cases, but we
    // can do it easily in the most common cases.
    //
    // This weakens the contract here, since we're adjusting the ratio under
    // the hood to the closest value that will work without introducing those
    // tiny gaps. So the user might change their `editor.lineHeight` from `1.5`
    // to `1.6` and correctly observe that nothing seems to have changed. We
    // think that's OK — and, in the unlikely event a user thinks this is
    // wrong, we can advise them on how to avoid this behavior.
    let fontSize = this.config.get('editor.fontSize');
    let fontFamily = this.config.get('editor.fontFamily');
    let lineHeight = this.config.get('editor.lineHeight');
    let pixelRatio = window.devicePixelRatio;
    let adjustedLineHeight;

    // The config schema allows `editor.lineHeight` to be either a bare number
    // or a string; in the latter case, the expectation is that the user can
    // specify the value using any valid CSS measurement. This makes
    // interpretation of the value tricky!
    //
    // There's one case that should be treated identically to the number case…
    if (typeof lineHeight === 'string' && Number(lineHeight).toString() === lineHeight) {
      // …when the user has specified a string with bare number. We'll treat
      // this as if the setting were _actually_ a number.
      lineHeight = Number(lineHeight);
    }

    // There are other string-value cases that we may want to reconcile with
    // the Chromium rendering issue described above.
    if (typeof lineHeight === 'string') {
      if (lineHeight.endsWith('px')) {
        // The user has specified the `editor.lineHeight` setting with a pixel
        // value like `"27px"`. We want to make sure this value results in a
        // line-height that snaps to the hardware pixel grid, so we'll adjust
        // it if necessary.
        let lineHeightPixelValue = parseFloat(lineHeight);
        let computedLineHeight = Math.round(lineHeightPixelValue * pixelRatio) / pixelRatio;
        adjustedLineHeight = `${computedLineHeight.toFixed(6)}px`;
      } else {
        // If it's some other sort of string value, then we'll leave it as-is.
        // It could be a more exotic CSS measurement — `1.4rem`, `3ch`, etc. —
        // or it could just be altogether invalid. Either way, we can't easily
        // convert it into its pixel equivalent, so we won't bother to try to
        // avoid the Chromium rendering issue.
        adjustedLineHeight = lineHeight;
      }
    } else {
      // The `editor.lineHeight` setting is a number expressing a ratio based
      // on the value of `editor.fontSize`. We'll turn that into a pixel value
      // and adjust it if necessary so that it snaps to the hardware pixel
      // grid.
      //
      // For instance: most screens out there these days have a
      // `devicePixelRatio` of `2`, meaning that `1px` in CSS will use two
      // screen pixels. So this would have the effect of snapping the line
      // height to the nearest half-CSS-pixel.
      //
      // On older displays with lower DPI, `devicePixelRatio` would be `1`;
      // this adjustment would thus snap the value to the nearest whole pixel.
      let computedLineHeight = Math.round(fontSize * lineHeight * pixelRatio) / pixelRatio;
      adjustedLineHeight = `${computedLineHeight.toFixed(6)}px`;
    }

    const styleSheetSource = `atom-workspace {
  --editor-font-size: ${fontSize}px;
  --editor-font-family: ${fontFamily};
  --editor-line-height: ${adjustedLineHeight};
}`;
    this.styleManager.addStyleSheet(styleSheetSource, {
      sourcePath: 'global-text-editor-styles',
      priority: -1
    });
  }

  initialize(model, { config, project, styleManager, viewRegistry }) {
    this.handleCenterEnter = this.handleCenterEnter.bind(this);
    this.handleCenterLeave = this.handleCenterLeave.bind(this);
    this.handleEdgesMouseMove = _.throttle(
      this.handleEdgesMouseMove.bind(this),
      100
    );
    this.handleDockDragEnd = this.handleDockDragEnd.bind(this);
    this.handleDragStart = this.handleDragStart.bind(this);
    this.handleDragEnd = this.handleDragEnd.bind(this);
    this.handleDrop = this.handleDrop.bind(this);

    this.model = model;
    this.viewRegistry = viewRegistry;
    this.project = project;
    this.config = config;
    this.styleManager = styleManager;
    if (this.viewRegistry == null) {
      throw new Error(
        'Must pass a viewRegistry parameter when initializing WorkspaceElements'
      );
    }
    if (this.project == null) {
      throw new Error(
        'Must pass a project parameter when initializing WorkspaceElements'
      );
    }
    if (this.config == null) {
      throw new Error(
        'Must pass a config parameter when initializing WorkspaceElements'
      );
    }
    if (this.styleManager == null) {
      throw new Error(
        'Must pass a styleManager parameter when initializing WorkspaceElements'
      );
    }

    this.subscriptions = new CompositeDisposable(
      new Disposable(() => {
        this.paneContainer.removeEventListener(
          'mouseenter',
          this.handleCenterEnter
        );
        this.paneContainer.removeEventListener(
          'mouseleave',
          this.handleCenterLeave
        );
        window.removeEventListener('mousemove', this.handleEdgesMouseMove);
        window.removeEventListener('dragend', this.handleDockDragEnd);
        window.removeEventListener('dragstart', this.handleDragStart);
        window.removeEventListener('dragend', this.handleDragEnd, true);
        window.removeEventListener('drop', this.handleDrop, true);
      }),
      ...[
        this.model.getLeftDock(),
        this.model.getRightDock(),
        this.model.getBottomDock()
      ].map(dock =>
        dock.onDidChangeHovered(hovered => {
          if (hovered) this.hoveredDock = dock;
          else if (dock === this.hoveredDock) this.hoveredDock = null;
          this.checkCleanupDockHoverEvents();
        })
      )
    );
    this.initializeContent();
    this.observeScrollbarStyle();
    this.observeTextEditorFontConfig();

    this.paneContainer = this.model.getCenter().paneContainer.getElement();
    this.verticalAxis.appendChild(this.paneContainer);
    this.addEventListener('focus', this.handleFocus.bind(this));

    this.addEventListener('mousewheel', this.handleMousewheel.bind(this), {
      capture: true
    });
    window.addEventListener('dragstart', this.handleDragStart);
    window.addEventListener('mousemove', this.handleEdgesMouseMove);

    this.panelContainers = {
      top: this.model.panelContainers.top.getElement(),
      left: this.model.panelContainers.left.getElement(),
      right: this.model.panelContainers.right.getElement(),
      bottom: this.model.panelContainers.bottom.getElement(),
      header: this.model.panelContainers.header.getElement(),
      footer: this.model.panelContainers.footer.getElement(),
      modal: this.model.panelContainers.modal.getElement()
    };

    this.horizontalAxis.insertBefore(
      this.panelContainers.left,
      this.verticalAxis
    );
    this.horizontalAxis.appendChild(this.panelContainers.right);

    this.verticalAxis.insertBefore(
      this.panelContainers.top,
      this.paneContainer
    );
    this.verticalAxis.appendChild(this.panelContainers.bottom);

    this.insertBefore(this.panelContainers.header, this.horizontalAxis);
    this.appendChild(this.panelContainers.footer);

    this.appendChild(this.panelContainers.modal);

    this.paneContainer.addEventListener('mouseenter', this.handleCenterEnter);
    this.paneContainer.addEventListener('mouseleave', this.handleCenterLeave);

    return this;
  }

  destroy() {
    this.subscriptions.dispose();
  }

  getModel() {
    return this.model;
  }

  handleDragStart(event) {
    if (!isTab(event.target)) return;
    const { item } = event.target;
    if (!item) return;
    this.model.setDraggingItem(item);
    window.addEventListener('dragend', this.handleDragEnd, { capture: true });
    window.addEventListener('drop', this.handleDrop, { capture: true });
  }

  handleDragEnd(event) {
    this.dragEnded();
  }

  handleDrop(event) {
    this.dragEnded();
  }

  dragEnded() {
    this.model.setDraggingItem(null);
    window.removeEventListener('dragend', this.handleDragEnd, true);
    window.removeEventListener('drop', this.handleDrop, true);
  }

  handleCenterEnter(event) {
    // Just re-entering the center isn't enough to hide the dock toggle buttons, since they poke
    // into the center and we want to give an affordance.
    this.cursorInCenter = true;
    this.checkCleanupDockHoverEvents();
  }

  handleCenterLeave(event) {
    // If the cursor leaves the center, we start listening to determine whether one of the docs is
    // being hovered.
    this.cursorInCenter = false;
    this.updateHoveredDock({ x: event.pageX, y: event.pageY });
    window.addEventListener('dragend', this.handleDockDragEnd);
  }

  handleEdgesMouseMove(event) {
    this.updateHoveredDock({ x: event.pageX, y: event.pageY });
  }

  handleDockDragEnd(event) {
    this.updateHoveredDock({ x: event.pageX, y: event.pageY });
  }

  updateHoveredDock(mousePosition) {
    // If we haven't left the currently hovered dock, don't change anything.
    if (
      this.hoveredDock &&
      this.hoveredDock.pointWithinHoverArea(mousePosition, true)
    )
      return;

    const docks = [
      this.model.getLeftDock(),
      this.model.getRightDock(),
      this.model.getBottomDock()
    ];
    const nextHoveredDock = docks.find(
      dock =>
        dock !== this.hoveredDock && dock.pointWithinHoverArea(mousePosition)
    );
    docks.forEach(dock => {
      dock.setHovered(dock === nextHoveredDock);
    });
  }

  checkCleanupDockHoverEvents() {
    if (this.cursorInCenter && !this.hoveredDock) {
      window.removeEventListener('dragend', this.handleDockDragEnd);
    }
  }

  handleMousewheel(event) {
    if (
      event.ctrlKey &&
      this.config.get('editor.zoomFontWhenCtrlScrolling') &&
      event.target.closest('atom-text-editor') != null
    ) {
      if (event.wheelDeltaY > 0) {
        this.model.increaseFontSize();
      } else if (event.wheelDeltaY < 0) {
        this.model.decreaseFontSize();
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleFocus(event) {
    this.model.getActivePane().activate();
  }

  focusPaneViewAbove() {
    this.focusPaneViewInDirection('above');
  }

  focusPaneViewBelow() {
    this.focusPaneViewInDirection('below');
  }

  focusPaneViewOnLeft() {
    this.focusPaneViewInDirection('left');
  }

  focusPaneViewOnRight() {
    this.focusPaneViewInDirection('right');
  }

  focusPaneViewInDirection(direction, pane) {
    const activePane = this.model.getActivePane();
    const paneToFocus = this.nearestVisiblePaneInDirection(
      direction,
      activePane
    );
    paneToFocus && paneToFocus.focus();
  }

  moveActiveItemToPaneAbove(params) {
    this.moveActiveItemToNearestPaneInDirection('above', params);
  }

  moveActiveItemToPaneBelow(params) {
    this.moveActiveItemToNearestPaneInDirection('below', params);
  }

  moveActiveItemToPaneOnLeft(params) {
    this.moveActiveItemToNearestPaneInDirection('left', params);
  }

  moveActiveItemToPaneOnRight(params) {
    this.moveActiveItemToNearestPaneInDirection('right', params);
  }

  moveActiveItemToNearestPaneInDirection(direction, params) {
    const activePane = this.model.getActivePane();
    const nearestPaneView = this.nearestVisiblePaneInDirection(
      direction,
      activePane
    );
    if (nearestPaneView == null) {
      return;
    }
    if (params && params.keepOriginal) {
      activePane
        .getContainer()
        .copyActiveItemToPane(nearestPaneView.getModel());
    } else {
      activePane
        .getContainer()
        .moveActiveItemToPane(nearestPaneView.getModel());
    }
    nearestPaneView.focus();
  }

  nearestVisiblePaneInDirection(direction, pane) {
    const distance = function (pointA, pointB) {
      const x = pointB.x - pointA.x;
      const y = pointB.y - pointA.y;
      return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
    };

    const paneView = pane.getElement();
    const box = this.boundingBoxForPaneView(paneView);

    const paneViews = atom.workspace
      .getVisiblePanes()
      .map(otherPane => otherPane.getElement())
      .filter(otherPaneView => {
        const otherBox = this.boundingBoxForPaneView(otherPaneView);
        switch (direction) {
          case 'left':
            return otherBox.right.x <= box.left.x;
          case 'right':
            return otherBox.left.x >= box.right.x;
          case 'above':
            return otherBox.bottom.y <= box.top.y;
          case 'below':
            return otherBox.top.y >= box.bottom.y;
        }
      })
      .sort((paneViewA, paneViewB) => {
        const boxA = this.boundingBoxForPaneView(paneViewA);
        const boxB = this.boundingBoxForPaneView(paneViewB);
        switch (direction) {
          case 'left':
            return (
              distance(box.left, boxA.right) - distance(box.left, boxB.right)
            );
          case 'right':
            return (
              distance(box.right, boxA.left) - distance(box.right, boxB.left)
            );
          case 'above':
            return (
              distance(box.top, boxA.bottom) - distance(box.top, boxB.bottom)
            );
          case 'below':
            return (
              distance(box.bottom, boxA.top) - distance(box.bottom, boxB.top)
            );
        }
      });

    return paneViews[0];
  }

  boundingBoxForPaneView(paneView) {
    const boundingBox = paneView.getBoundingClientRect();

    return {
      left: { x: boundingBox.left, y: boundingBox.top },
      right: { x: boundingBox.right, y: boundingBox.top },
      top: { x: boundingBox.left, y: boundingBox.top },
      bottom: { x: boundingBox.left, y: boundingBox.bottom }
    };
  }

  runPackageSpecs(options = {}) {
    const activePaneItem = this.model.getActivePaneItem();
    const activePath =
      activePaneItem && typeof activePaneItem.getPath === 'function'
        ? activePaneItem.getPath()
        : null;
    let projectPath;
    if (activePath != null) {
      [projectPath] = this.project.relativizePath(activePath);
    } else {
      [projectPath] = this.project.getPaths();
    }
    if (projectPath) {
      let specPath = path.join(projectPath, 'spec');
      const testPath = path.join(projectPath, 'test');
      if (!fs.existsSync(specPath) && fs.existsSync(testPath)) {
        specPath = testPath;
      }

      ipcRenderer.send('run-package-specs', specPath, options);
    }
  }
}

function isTab(element) {
  let el = element;
  while (el != null) {
    if (el.getAttribute && el.getAttribute('is') === 'tabs-tab') return true;
    el = el.parentElement;
  }
  return false;
}

window.customElements.define('atom-workspace', WorkspaceElement);

function createWorkspaceElement() {
  return document.createElement('atom-workspace');
}

module.exports = {
  createWorkspaceElement
};
