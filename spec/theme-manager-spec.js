const path = require('path');
const fs = require('fs-plus');
const temp = require('temp').track();

describe('atom.themes', function() {
  beforeEach(function() {
    spyOn(atom, 'inSpecMode').and.returnValue(false);
    spyOn(console, 'warn');
  });

  afterEach(async function() {
    await atom.themes.deactivateThemes();

    try {
      temp.cleanupSync();
    } catch (error) {}
  });

  describe('theme getters and setters', function() {
    beforeEach(function() {
      jasmine.snapshotDeprecations();
      atom.packages.loadPackages();
    });

    afterEach(() => jasmine.restoreDeprecationsSnapshot());

    describe('getLoadedThemes', () =>
      it('gets all the loaded themes', function() {
        const themes = atom.themes.getLoadedThemes();
        expect(themes.length).toBeGreaterThan(2);
      }));

    describe('getActiveThemes', () =>
      it('gets all the active themes', async function() {
        await atom.themes.activateThemes();

        const names = atom.config.get('core.themes');
        expect(names.length).toBeGreaterThan(0);
        const themes = atom.themes.getActiveThemes();
        expect(themes).toHaveLength(names.length);
      }));
  });

  describe('when the core.themes config value contains invalid entry', () =>
    it('ignores theme', function() {
      atom.config.set('core.themes', [
        'atom-light-ui',
        null,
        undefined,
        '',
        false,
        4,
        {},
        [],
        'atom-dark-ui'
      ]);

      expect(atom.themes.getEnabledThemeNames()).toEqual([
        'atom-dark-ui',
        'atom-light-ui'
      ]);
    }));

  describe('::getImportPaths()', function() {
    it('returns the theme directories before the themes are loaded', function() {
      atom.config.set('core.themes', [
        'theme-with-index-less',
        'atom-dark-ui',
        'atom-light-ui'
      ]);

      const paths = atom.themes.getImportPaths();

      // syntax theme is not a dir at this time, so only two.
      expect(paths.length).toBe(2);
      expect(paths[0]).toContain('atom-light-ui');
      expect(paths[1]).toContain('atom-dark-ui');
    });

    it('ignores themes that cannot be resolved to a directory', function() {
      atom.config.set('core.themes', ['definitely-not-a-theme']);
      expect(() => atom.themes.getImportPaths()).not.toThrow();
    });
  });

  describe('when the core.themes config value changes', function() {
    it('add/removes stylesheets to reflect the new config value', async function() {
      let didChangeActiveThemesHandler = jasmine.createSpy();
      atom.themes.onDidChangeActiveThemes(didChangeActiveThemesHandler);
      spyOn(atom.styles, 'getUserStyleSheetPath').and.callFake(() => null);

      await atom.themes.activateThemes();

      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve)
        atom.config.set('core.themes', []);
      })

      expect(document.querySelectorAll('style.theme')).toHaveLength(0);

      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve);
        atom.config.set('core.themes', ['atom-dark-ui']);
      })

      expect(document.querySelectorAll('style[priority="1"]')).toHaveLength(2);
      expect(
        document
          .querySelector('style[priority="1"]')
          .getAttribute('source-path')
      ).toMatch(/atom-dark-ui/);

      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve);
        atom.config.set('core.themes', ['atom-light-ui', 'atom-dark-ui']);
      });

      expect(document.querySelectorAll('style[priority="1"]')).toHaveLength(2);
      expect(
        document
          .querySelectorAll('style[priority="1"]')[0]
          .getAttribute('source-path')
      ).toMatch(/atom-dark-ui/);
      expect(
        document
          .querySelectorAll('style[priority="1"]')[1]
          .getAttribute('source-path')
      ).toMatch(/atom-light-ui/);

      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve);
        atom.config.set('core.themes', []);
      })

      expect(document.querySelectorAll('style[priority="1"]')).toHaveLength(2);


      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve);
        // atom-dark-ui has a directory path, the syntax one doesn't
        atom.config.set('core.themes', [
          'theme-with-index-less',
          'atom-dark-ui'
        ]);
      })

      expect(document.querySelectorAll('style[priority="1"]')).toHaveLength(2);
      const importPaths = atom.themes.getImportPaths();
      expect(importPaths.length).toBe(1);
      expect(importPaths[0]).toContain('atom-dark-ui');
    });

    it('adds theme-* classes to the workspace for each active theme', async function() {
      atom.config.set('core.themes', ['atom-dark-ui', 'atom-dark-syntax']);

      let didChangeActiveThemesHandler = jasmine.createSpy();
      atom.themes.onDidChangeActiveThemes(didChangeActiveThemesHandler);

      await atom.themes.activateThemes();

      const workspaceElement = atom.workspace.getElement();
      expect(workspaceElement).toHaveClass('theme-atom-dark-ui');

      atom.themes.onDidChangeActiveThemes(
        (didChangeActiveThemesHandler = jasmine.createSpy())
      );

      await new Promise((resolve) => {
        didChangeActiveThemesHandler.and.callFake(resolve);
        atom.config.set('core.themes', [
          'theme-with-ui-variables',
          'theme-with-syntax-variables'
        ]);
      });

      // `theme-` twice as it prefixes the name with `theme-`
      expect(workspaceElement).toHaveClass('theme-theme-with-ui-variables');
      expect(workspaceElement).toHaveClass(
        'theme-theme-with-syntax-variables'
      );
      expect(workspaceElement).not.toHaveClass('theme-atom-dark-ui');
      expect(workspaceElement).not.toHaveClass('theme-atom-dark-syntax');
    });
  });

  describe('when a theme fails to load', () =>
    it('logs a warning', function() {
      console.warn.calls.reset();
      atom.packages
        .activatePackage('a-theme-that-will-not-be-found')
        .then(function() {}, function() {});
      expect(console.warn.calls.count()).toBe(1);
      expect(console.warn.calls.argsFor(0)[0]).toContain(
        "Could not resolve 'a-theme-that-will-not-be-found'"
      );
    }));

  describe('::requireStylesheet(path)', function() {
    beforeEach(() => jasmine.snapshotDeprecations());

    afterEach(() => jasmine.restoreDeprecationsSnapshot());

    it('synchronously loads css at the given path and installs a style tag for it in the head', function() {
      let styleElementAddedHandler;
      atom.styles.onDidAddStyleElement(
        (styleElementAddedHandler = jasmine.createSpy(
          'styleElementAddedHandler'
        ))
      );

      const cssPath = getAbsolutePath(
        atom.project.getDirectories()[0],
        'css.css'
      );
      const lengthBefore = document.querySelectorAll('head style').length;

      atom.themes.requireStylesheet(cssPath);
      expect(document.querySelectorAll('head style').length).toBe(
        lengthBefore + 1
      );

      expect(styleElementAddedHandler).toHaveBeenCalled();

      const element = document.querySelector(
        'head style[source-path*="css.css"]'
      );
      expect(element.getAttribute('source-path')).toEqualPath(cssPath);
      expect(element.textContent).toBe(fs.readFileSync(cssPath, 'utf8'));

      // doesn't append twice
      styleElementAddedHandler.calls.reset();
      atom.themes.requireStylesheet(cssPath);
      expect(document.querySelectorAll('head style').length).toBe(
        lengthBefore + 1
      );
      expect(styleElementAddedHandler).not.toHaveBeenCalled();

      document
        .querySelectorAll('head style[id*="css.css"]')
        .forEach(styleElement => {
          styleElement.remove();
        });
    });

    it('synchronously loads and parses less files at the given path and installs a style tag for it in the head', function() {
      const lessPath = getAbsolutePath(
        atom.project.getDirectories()[0],
        'sample.less'
      );
      const lengthBefore = document.querySelectorAll('head style').length;
      atom.themes.requireStylesheet(lessPath);
      expect(document.querySelectorAll('head style').length).toBe(
        lengthBefore + 1
      );

      const element = document.querySelector(
        'head style[source-path*="sample.less"]'
      );
      expect(element.getAttribute('source-path')).toEqualPath(lessPath);
      expect(element.textContent.toLowerCase()).toBe(`\
#header {
  color: #4d926f;
}
h2 {
  color: #4d926f;
}
\
`);

      // doesn't append twice
      atom.themes.requireStylesheet(lessPath);
      expect(document.querySelectorAll('head style').length).toBe(
        lengthBefore + 1
      );
      document
        .querySelectorAll('head style[id*="sample.less"]')
        .forEach(styleElement => {
          styleElement.remove();
        });
    });

    it('supports requiring css and less stylesheets without an explicit extension', function() {
      atom.themes.requireStylesheet(path.join(__dirname, 'fixtures', 'css'));
      expect(
        document
          .querySelector('head style[source-path*="css.css"]')
          .getAttribute('source-path')
      ).toEqualPath(
        getAbsolutePath(atom.project.getDirectories()[0], 'css.css')
      );
      atom.themes.requireStylesheet(path.join(__dirname, 'fixtures', 'sample'));
      expect(
        document
          .querySelector('head style[source-path*="sample.less"]')
          .getAttribute('source-path')
      ).toEqualPath(
        getAbsolutePath(atom.project.getDirectories()[0], 'sample.less')
      );

      document.querySelector('head style[source-path*="css.css"]').remove();
      document.querySelector('head style[source-path*="sample.less"]').remove();
    });

    it('returns a disposable allowing styles applied by the given path to be removed', function() {
      const cssPath = require.resolve('./fixtures/css.css');

      expect(getComputedStyle(document.body).fontWeight).not.toBe('700');
      const disposable = atom.themes.requireStylesheet(cssPath);
      expect(getComputedStyle(document.body).fontWeight).toBe('700');

      let styleElementRemovedHandler;
      atom.styles.onDidRemoveStyleElement(
        (styleElementRemovedHandler = jasmine.createSpy(
          'styleElementRemovedHandler'
        ))
      );

      disposable.dispose();

      expect(getComputedStyle(document.body).fontWeight).not.toBe('bold');

      expect(styleElementRemovedHandler).toHaveBeenCalled();
    });
  });

  describe('base style sheet loading', function() {
    beforeEach(async function() {
      const workspaceElement = atom.workspace.getElement();
      jasmine.attachToDOM(atom.workspace.getElement());
      workspaceElement.appendChild(document.createElement('atom-text-editor'));

      await atom.themes.activateThemes();
    });

    it("loads the correct values from the theme's ui-variables file", async function() {
      await new Promise((resolve) => {
        atom.themes.onDidChangeActiveThemes(resolve);
        atom.config.set('core.themes', [
          'theme-with-ui-variables',
          'theme-with-syntax-variables'
        ]);
      })

      // an override loaded in the base css
      expect(
        getComputedStyle(atom.workspace.getElement())['background-color']
      ).toBe('rgb(0, 0, 255)');

      // from within the theme itself
      expect(
        getComputedStyle(document.querySelector('atom-text-editor'))
          .paddingTop
      ).toBe('150px');
      expect(
        getComputedStyle(document.querySelector('atom-text-editor'))
          .paddingRight
      ).toBe('150px');
      expect(
        getComputedStyle(document.querySelector('atom-text-editor'))
          .paddingBottom
      ).toBe('150px');
    });

    describe('when there is a theme with incomplete variables', () =>
      it('loads the correct values from the fallback ui-variables', async function() {
        await new Promise((resolve) => {
          atom.themes.onDidChangeActiveThemes(resolve);
          atom.config.set('core.themes', [
            'theme-with-incomplete-ui-variables',
            'theme-with-syntax-variables'
          ]);
        })

        // an override loaded in the base css
        expect(
          getComputedStyle(atom.workspace.getElement())['background-color']
        ).toBe('rgb(0, 0, 255)');

        // from within the theme itself
        expect(
          getComputedStyle(document.querySelector('atom-text-editor'))
            .backgroundColor
        ).toBe('rgb(0, 152, 255)');
      }));
  });

  describe('user stylesheet', function() {
    let userStylesheetPath;
    beforeEach(function() {
      userStylesheetPath = path.join(temp.mkdirSync('atom'), 'styles.less');
      fs.writeFileSync(
        userStylesheetPath,
        'body {border-style: dotted !important;}'
      );
      spyOn(atom.styles, 'getUserStyleSheetPath').and.returnValue(userStylesheetPath);
    });

    describe('when the user stylesheet changes', function() {
      beforeEach(() => jasmine.snapshotDeprecations());

      afterEach(() => jasmine.restoreDeprecationsSnapshot());

      it('reloads it', async function() {
        let styleElementAddedHandler = jasmine.createSpy('styleElementRemovedHandler');
        let styleElementRemovedHandler = jasmine.createSpy('styleElementAddedHandler');

        atom.themes._originalLoadUserStylesheet = atom.themes.loadUserStylesheet;
        const loadUserStylesheetSpy = spyOn(atom.themes, 'loadUserStylesheet').and.callThrough();

        await atom.themes.activateThemes();

        atom.styles.onDidRemoveStyleElement(styleElementRemovedHandler);
        atom.styles.onDidAddStyleElement(styleElementAddedHandler);

        expect(getComputedStyle(document.body).borderStyle).toBe('dotted');

        await new Promise((resolve) => {
          loadUserStylesheetSpy.and.callFake((...args) => {
            atom.themes._originalLoadUserStylesheet(...args);
            resolve();
          });
          fs.writeFileSync(userStylesheetPath, 'body {border-style: dashed}');
        })

        expect(getComputedStyle(document.body).borderStyle).toBe('dashed');

        expect(styleElementRemovedHandler).toHaveBeenCalled();
        expect(
          styleElementRemovedHandler.calls.argsFor(0)[0].textContent
        ).toContain('dotted');

        expect(styleElementAddedHandler).toHaveBeenCalled();
        expect(
          styleElementAddedHandler.calls.argsFor(0)[0].textContent
        ).toContain('dashed');

        styleElementRemovedHandler.calls.reset();

        await new Promise((resolve) => {
          loadUserStylesheetSpy.and.callFake((...args) => {
            atom.themes._originalLoadUserStylesheet(...args);
            resolve();
          });
          fs.removeSync(userStylesheetPath);
        })

        expect(styleElementRemovedHandler).toHaveBeenCalled();
        expect(
          styleElementRemovedHandler.calls.argsFor(0)[0].textContent
        ).toContain('dashed');
        expect(getComputedStyle(document.body).borderStyle).toBe('none');
      });
    });

    describe('when there is an error reading the stylesheet', function() {
      let addErrorHandler = null;
      beforeEach(function() {
        atom.themes.loadUserStylesheet();
        spyOn(atom.themes.lessCache, 'cssForFile').and.callFake(function() {
          throw new Error('EACCES permission denied "styles.less"');
        });
        atom.notifications.onDidAddNotification(
          (addErrorHandler = jasmine.createSpy())
        );
      });

      it('creates an error notification and does not add the stylesheet', function() {
        atom.themes.loadUserStylesheet();
        expect(addErrorHandler).toHaveBeenCalled();
        const note = addErrorHandler.calls.mostRecent().args[0];
        expect(note.getType()).toBe('error');
        expect(note.getMessage()).toContain('Error loading');
        expect(
          atom.styles.styleElementsBySourcePath[
            atom.styles.getUserStyleSheetPath()
          ]
        ).toBeUndefined();
      });
    });

    describe('when there is an error watching the user stylesheet', function() {
      let addErrorHandler = null;
      beforeEach(function() {
        const { File } = require('pathwatcher');
        spyOn(File.prototype, 'on').and.callFake(function(event) {
          if (event.indexOf('contents-changed') > -1) {
            throw new Error('Unable to watch path');
          }
        });
        spyOn(atom.themes, 'loadStylesheet').and.returnValue('');
        atom.notifications.onDidAddNotification(
          (addErrorHandler = jasmine.createSpy())
        );
      });

      it('creates an error notification', function() {
        atom.themes.loadUserStylesheet();
        expect(addErrorHandler).toHaveBeenCalled();
        const note = addErrorHandler.calls.mostRecent().args[0];
        expect(note.getType()).toBe('error');
        expect(note.getMessage()).toContain('Unable to watch path');
      });
    });

    it("adds a notification when a theme's stylesheet is invalid", function() {
      const addErrorHandler = jasmine.createSpy();
      atom.notifications.onDidAddNotification(addErrorHandler);
      expect(() =>
        atom.packages
          .activatePackage('theme-with-invalid-styles')
          .then(function() {}, function() {})
      ).not.toThrow();
      expect(addErrorHandler.calls.count()).toBe(2);
      expect(addErrorHandler.calls.argsFor(1)[0].message).toContain(
        'Failed to activate the theme-with-invalid-styles theme'
      );
    });
  });

  describe('when a non-existent theme is present in the config', function() {
    beforeEach(async function() {
      console.warn.calls.reset();
      atom.config.set('core.themes', [
        'non-existent-dark-ui',
        'non-existent-dark-syntax'
      ]);

      await atom.themes.activateThemes();
    });

    it('uses the default one-dark UI and syntax themes and logs a warning', function() {
      const activeThemeNames = atom.themes.getActiveThemeNames();
      expect(console.warn.calls.count()).toBe(2);
      expect(activeThemeNames.length).toBe(2);
      expect(activeThemeNames).toContain('one-dark-ui');
      expect(activeThemeNames).toContain('one-dark-syntax');
    });
  });

  describe('when in safe mode', function() {
    describe('when the enabled UI and syntax themes are bundled with Atom', function() {
      beforeEach(async function() {
        atom.config.set('core.themes', ['atom-light-ui', 'atom-dark-syntax']);

        await atom.themes.activateThemes();
      });

      it('uses the enabled themes', function() {
        const activeThemeNames = atom.themes.getActiveThemeNames();
        expect(activeThemeNames.length).toBe(2);
        expect(activeThemeNames).toContain('atom-light-ui');
        expect(activeThemeNames).toContain('atom-dark-syntax');
      });
    });

    describe('when the enabled UI and syntax themes are not bundled with Atom', function() {
      beforeEach(async function() {
        atom.config.set('core.themes', [
          'installed-dark-ui',
          'installed-dark-syntax'
        ]);

        await atom.themes.activateThemes();
      });

      it('uses the default dark UI and syntax themes', function() {
        const activeThemeNames = atom.themes.getActiveThemeNames();
        expect(activeThemeNames.length).toBe(2);
        expect(activeThemeNames).toContain('one-dark-ui');
        expect(activeThemeNames).toContain('one-dark-syntax');
      });
    });

    describe('when the enabled UI theme is not bundled with Atom', function() {
      beforeEach(async function() {
        atom.config.set('core.themes', [
          'installed-dark-ui',
          'atom-light-syntax'
        ]);

        await atom.themes.activateThemes();
      });

      it('uses the default one-dark UI theme', function() {
        const activeThemeNames = atom.themes.getActiveThemeNames();
        expect(activeThemeNames.length).toBe(2);
        expect(activeThemeNames).toContain('one-dark-ui');
        expect(activeThemeNames).toContain('atom-light-syntax');
      });
    });

    describe('when the enabled syntax theme is not bundled with Atom', function() {
      beforeEach(async function() {
        atom.config.set('core.themes', [
          'atom-light-ui',
          'installed-dark-syntax'
        ]);

        await atom.themes.activateThemes();
      });

      it('uses the default one-dark syntax theme', function() {
        const activeThemeNames = atom.themes.getActiveThemeNames();
        expect(activeThemeNames.length).toBe(2);
        expect(activeThemeNames).toContain('atom-light-ui');
        expect(activeThemeNames).toContain('one-dark-syntax');
      });
    });
  });
});

function getAbsolutePath(directory, relativePath) {
  if (directory) {
    return directory.resolve(relativePath);
  }
}
