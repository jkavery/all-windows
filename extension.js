const GObject = imports.gi.GObject;
const St = imports.gi.St;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const GLib = imports.gi.GLib;

/*
  This extension is based on the All Windows GNOME Shell extension (https://github.com/lyonel/all-windows) by Lyonel Vincent.
  It adds save/restore window posiitons functionality.
*/

const EXTENSION_NAME = 'All Windows + Save/Restore Window Positions';

// At module scope to ride out the extension disable/enable for a system suspend/resume
// Note that this appears to violate https://gjs.guide/extensions/review-guidelines/review-guidelines.html#destroy-all-objects
// though the earlier the example shows init() creating an extension object.  The extension object is empty, but it's still an object.
// This map will contain primitives but never any object references.  Are Gobject references what the guidelines are actually prohibiting?
// If this extension were written in the style shown in the guidelines, it looks like this would be part of the Extension class,
// initialized by init().
const displaySize__windowId__state = new Map();

// The following are only used for logging
const EXTENSION_LOG_NAME = 'All Windows SRWP';
const START_TIME = GLib.DateTime.new_now_local().format_iso8601();

const LOG_NOTHING = 0;
const LOG_ERROR = 1;
const LOG_INFO = 2;
const LOG_DEBUG = 3;
const LOG_EVERYTHING = 4;

const LOG_LEVEL = LOG_ERROR;

class WindowState {
    constructor(window, log) {
        this._rect = window.get_frame_rect();
        this._maximized = window.get_maximized();
        this._minimized = window.minimized;
        // The following are only used for logging
        this._fullscreen = window.fullscreen;
        this._id = window.get_id();
        this._title = window.get_title();
        this._log = log;
        if (log >= LOG_INFO)
            global.log(`${EXTENSION_LOG_NAME} Save ${this}`);
    }

    toString() {
        const r = this._rect;
        return `x:${r.x}, y:${r.y}, w:${r.width}, h:${r.height}, maximized:${this._maximized}, ` +
            `minimized:${this._minimized}, fullscreen:${this._fullscreen}, id:${this._id}, title:${this._title}`;
    }

    restore(currentWindow) {
        if (!this._equalRect(currentWindow)) {
            if (currentWindow.get_maximized())
                currentWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            this._moveResizeFrame(currentWindow);
        }
        this._setMaximized(currentWindow);
        this._setMinimized(currentWindow);
        this._logDifferences(currentWindow);
    }

    _equalRect(window) {
        const r = window.get_frame_rect();
        return this._rect.x === r.x && this._rect.y === r.y &&
            this._rect.width === r.width && this._rect.height === r.height;
    }

    _moveResizeFrame(window) {
        // Is it correct to set user_op => true?  Is this performing a user operation?
        window.move_resize_frame(true, this._rect.x, this._rect.y, this._rect.width, this._rect.height);
    }

    _setMaximized(window) {
        if (window.get_maximized() !== this._maximized) {
            if (this._maximized)
                window.maximize(this._maximized);
            else
                window.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }

    _setMinimized(window) {
        if (window.minimized !== this._minimized) {
            if (this._minimized)
                window.minimize();
            else
                window.unminimize();
        }
    }

    _logDifferences(window) {
        if (this._log >= LOG_ERROR) {
            let hasDiffs = false;
            if (window.minimized !== this._minimized) {
                global.log(`${EXTENSION_LOG_NAME} Error: Wrong minimized: ${window.minimized()}, title:${this._title}`);
                hasDiffs = true;
            }
            if (window.get_maximized() !== this._maximized) {
                global.log(`${EXTENSION_LOG_NAME} Error: Wrong maximized: ${window.get_maximized()}, title:${this._title}`);
                hasDiffs = true;
            }
            // This test fails when there is a difference between saved and current maximization, though the window
            // behaviour is correct.  Due to an asynchronous update?
            if (this._log >= LOG_EVERYTHING && !this._equalRect(window)) {
                const r = window.get_frame_rect();
                global.log(`${EXTENSION_LOG_NAME} Error: Wrong rectangle: x:${r.x}, y:${r.y}, w:${r.width}, h:${r.height}, title:${this._title}`);
                hasDiffs = true;
            }
            if (hasDiffs)
                global.log(`${EXTENSION_LOG_NAME} Expecting: ${this}`);
        }
    }
}

class AllWindowsStates {
    constructor(log) {
        this._log = log;
    }

    _getWindows() {
        return global.get_window_actors().map(a => a.meta_window).filter(w => !w.is_skip_taskbar());
    }

    _getWindowStateMap(why) {
        const size = global.display.get_size();
        const displaySizeKey = size[0] * 100000 + size[1];
        if (!displaySize__windowId__state.has(displaySizeKey))
            displaySize__windowId__state.set(displaySizeKey, new Map());
        const windowId__state = displaySize__windowId__state.get(displaySizeKey);
        if (this._log >= LOG_DEBUG)
            global.log(`${EXTENSION_LOG_NAME} ${why} map size: ${windowId__state.size}  display size: ${size}  start time: ${START_TIME}`);
        return windowId__state;
    }

    saveWindowPositions(why) {
        const windowId__state = this._getWindowStateMap(why);
        windowId__state.clear();
        for (const window of this._getWindows())
            windowId__state.set(window.get_id(), new WindowState(window, this._log));
    }

    restoreWindowPositions(why) {
        const windowId__state = this._getWindowStateMap(why);
        for (const window of this._getWindows()) {
            if (windowId__state.has(window.get_id()))
                windowId__state.get(window.get_id()).restore(window);
            else if (this._log >= LOG_DEBUG)
                global.log(`${EXTENSION_LOG_NAME} ${why} did not find: ${window.get_id()} ${window.get_title()}`);
        }
    }
}

// The code below is from the All Windows GNOME Shell extension (https://github.com/lyonel/all-windows) with these changes:
// * fixes for errors logged in syslog by GNOME Shell 40,
// * removal of uses of the Lang module,
// * fixes for gnome-eslint, and
// * addition of _allWindowsStates code.
const WindowList = GObject.registerClass({
}, class WindowList extends PanelMenu.Button {
    _init() {
        super._init(0.0, EXTENSION_NAME);

        this._allWindowsStates = new AllWindowsStates(LOG_LEVEL);
        this._allWindowsStates.restoreWindowPositions('Enable restore');

        this.add_child(new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'}));
        this.updateMenu();

        this._restacked = global.display.connect('restacked', () => this.updateMenu());
    }

    destroy() {
        global.display.disconnect(this._restacked);

        if (this._allWindowsStates)
            this._allWindowsStates.saveWindowPositions('Disable save');

        super.destroy();
    }


    updateMenu() {
        this.menu.removeAll();
        let empty_menu = true;

        let tracker = Shell.WindowTracker.get_default();
        {
            let item = new PopupMenu.PopupMenuItem('Save window positions');
            item.connect('activate', () => this._allWindowsStates.saveWindowPositions('Save'));
            this.menu.addMenuItem(item);

            item = new PopupMenu.PopupMenuItem('Restore window positions');
            item.connect('activate', () => this._allWindowsStates.restoreWindowPositions('Restore'));
            this.menu.addMenuItem(item);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        for (let wks = 0; wks < global.workspace_manager.n_workspaces; ++wks) {
            // construct a list with all windows
            let workspace_name = Meta.prefs_get_workspace_name(wks);
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(wks);
            let windows = metaWorkspace.list_windows();
            let sticky_windows = windows.filter(
                function (w) {
                    return !w.is_skip_taskbar() && w.is_on_all_workspaces();
                }
            );
            windows = windows.filter(
                function (w) {
                    return !w.is_skip_taskbar() && !w.is_on_all_workspaces();
                }
            );

            if (sticky_windows.length && (wks === 0)) {
                for (let i = 0; i < sticky_windows.length; ++i) {
                    let metaWindow = sticky_windows[i];
                    let item = new PopupMenu.PopupMenuItem('');
                    item.connect('activate', () => this.activateWindow(metaWorkspace, metaWindow));
                    item._window = sticky_windows[i];
                    let app = tracker.get_window_app(item._window);
                    let box = new St.BoxLayout({x_expand: true});
                    item._icon = app.create_icon_texture(24);
                    box.add(new St.Label({text: ellipsizedWindowTitle(metaWindow), x_expand: true}));
                    box.add(new St.Label({text: ' '}));
                    box.add(item._icon);
                    item.add_actor(box);
                    this.menu.addMenuItem(item);
                    empty_menu = false;
                }
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            if (windows.length) {
                if (wks > 0)
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                if (global.workspace_manager.n_workspaces > 1) {
                    let item = new PopupMenu.PopupMenuItem(workspace_name);
                    item.reactive = false;
                    item.can_focus = false;
                    if (wks === global.workspace_manager.get_active_workspace().index())
                        item.setOrnament(PopupMenu.Ornament.DOT);
                    this.menu.addMenuItem(item);
                    empty_menu = false;
                }


                for (let i = 0; i < windows.length; ++i) {
                    let metaWindow = windows[i];
                    let item = new PopupMenu.PopupMenuItem('');
                    item.connect('activate', () => this.activateWindow(metaWorkspace, metaWindow));
                    item._window = windows[i];
                    let app = tracker.get_window_app(item._window);
                    let box = new St.BoxLayout({x_expand: true});
                    item._icon = app.create_icon_texture(24);
                    box.add(new St.Label({text: ellipsizedWindowTitle(metaWindow), x_expand: true}));
                    box.add(new St.Label({text: ' '}));
                    box.add(item._icon);
                    item.add_actor(box);
                    this.menu.addMenuItem(item);
                    empty_menu = false;
                }
            }
        }

        if (empty_menu) {
            // Translation NYI
            // let item = new PopupMenu.PopupMenuItem(_("No open windows"));
            // item.reactive = false;
            // item.can_focus = false;
            // this.menu.addMenuItem(item);

            this.hide();
        } else {
            this.show();
        }
    }

    activateWindow(metaWorkspace, metaWindow) {
        if (!metaWindow.is_on_all_workspaces())
            metaWorkspace.activate(global.get_current_time());
        metaWindow.unminimize();
        metaWindow.unshade(global.get_current_time());
        metaWindow.activate(global.get_current_time());
    }

    _onButtonPress(actor, event) {
        this.updateMenu();
        this.parent(actor, event);
    }
});

let _windowlist;

function ellipsizeString(s, l) {
    if (s.length > l)
        return `${s.substr(0, l)}...`;
    return s;
}

function ellipsizedWindowTitle(w) {
    return ellipsizeString(w.get_title(), 100);
}

function init() {
}

function enable() {
    _windowlist = new WindowList();
    Main.panel.addToStatusArea('window-list', _windowlist, -1);
}

function disable() {
    if (_windowlist) {
        _windowlist.destroy();
        _windowlist = null;
    }
}
