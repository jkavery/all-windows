'use strict';

import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
const { Clutter } = imports.gi;

// import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

/*
  This extension is based on the All Windows GNOME Shell extension (https://github.com/lyonel/all-windows) by Lyonel Vincent.
  It adds save/restore window posiitons functionality.
*/

// The following are only used for logging
const EXTENSION_LOG_NAME = 'All Windows SRWP';
const START_TIME = GLib.DateTime.new_now_local().format_iso8601();
let enableCount = 0;

const LOG_ERROR = 1;
const LOG_INFO = 2;
const LOG_DEBUG = 3;
const LOG_EVERYTHING = 4;

const LOG_DEFAULT = LOG_ERROR;

class Log {
    #enableCount;
    // Intended to be called at the beginning of Extension.enable().
    constructor(settings) {
        // Reading the debug logging setting only when constructed at each enable is good enough.
        // The setting could be bound to the WindowList GObject so changes took effect immediately,
        // but that is ugly and brittle.
        const level = settings.get_boolean("debug") ? LOG_DEBUG : LOG_DEFAULT;
        this.debugp = level >= LOG_DEBUG;
        enableCount += 1;
        this.#enableCount = enableCount;
        this.prefix = `${EXTENSION_LOG_NAME} #${this.#enableCount}:`;
    }

    // Don't use console.debug(), so that debug control is only by settings and LOG_DEFAULT.

    log(msg) {
        console.log(`${EXTENSION_LOG_NAME} #${this.#enableCount}: ${msg}`);
    }
    error(msg) {
        console.error(`${EXTENSION_LOG_NAME} #${this.#enableCount} Error: ${msg}`);
    }
    exception(msg, e) {
        console.error(`${EXTENSION_LOG_NAME} #${this.#enableCount} Exception: ${msg}:\n`, e);
    }

    // Use when msg doesn't need to be built at runtime
    debug(msg) {
        if (this.debugp)
            this.log(msg);
    }
}

const DISPLAYS_WINDOWS_STATE_FILE = "displays-windows-state.json"

// True if the persisted window state is for the Gnome that is running.
// At module scope to ride out the extension disable/enable for a system suspend/resume.
// Initialized, but otherwise never set, to false.
let windowStateSaved = false;

//////// File I/O ////////

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

class Persist {
    #log;
    #enabled;
    #stateFile;
    constructor(uuid, log) {
        this.#log = log;
        const directoryPath = GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
        // Not an asynchronous mkdir because that would require a lot of code for little benefit.
        // Any directories are only created once, though two file tests are done every suspend/resume.
        this.#enabled = (GLib.mkdir_with_parents(directoryPath, 0o755) === 0);
        if (! this.#enabled) {
            this.#log.error(`could not make directory ${directoryPath} - window positions will not be saved across suspend/resume`);
        }
        this.#stateFile = Gio.File.new_for_path(GLib.build_filenamev([directoryPath, DISPLAYS_WINDOWS_STATE_FILE]));
    }

    async save(obj) {
        if (this.#enabled) {
            const str = JSON.stringify(obj, Persist.#replacer);
            if (this.#log.debugp) {
                this.#log.log(`Saving state to ${DISPLAYS_WINDOWS_STATE_FILE}`);
            }
            const bytes = new GLib.Bytes(str);
            await this.#stateFile.replace_contents_bytes_async(
                bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            if (this.#log.debugp) {
                this.#log.log(`Saved state to ${DISPLAYS_WINDOWS_STATE_FILE}`);
            }
            return true;
        }
        return false;
    }

    async load() {
        if (this.#enabled) {
            if (this.#log.debugp) {
                this.#log.log(`Loading ${DISPLAYS_WINDOWS_STATE_FILE}`);
            }
            const [contents,] = await this.#stateFile.load_contents_async(null);
            if (contents) {
                const str = new TextDecoder().decode(contents);
                if (this.#log.debugp) {
                    this.#log.log(`Loaded ${DISPLAYS_WINDOWS_STATE_FILE}`);
                }
                const ret = JSON.parse(str, Persist.#reviver);
                return ret;
            }
            throw new Error(`${this.#log.prefix} load failed: No contents found in ${DISPLAYS_WINDOWS_STATE_FILE}`)
        }
        throw new Error(`${this.#log.prefix} load failed: No directory for ${DISPLAYS_WINDOWS_STATE_FILE}`)
    }

    // This and #reviver are from https://stackoverflow.com/questions/29085197/how-do-you-json-stringify-an-es6-map/56150320#56150320
    static #replacer(key, value) {
        if (value instanceof Map) {
            return {
                dataType: 'Map',
                value: [...value],
            };
        }
        if (value instanceof WindowState) {
            return {
                dataType: 'WindowState',
                value: Object.fromEntries(Object.entries(value))
            };
        }
        return value;
    }

    static #reviver(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (value.dataType === 'Map') {
                return new Map(value.value);
            }
        }
        if (typeof value === 'object' && value !== null) {
            if (value.dataType === 'WindowState') {
                const ret = new WindowState();
                Object.assign(ret, value.value);
                return ret;
            }
        }
        return value;
    }
}

//////// Save/Restore Window Postions ////////

class WindowState {
    #log;
    constructor(x, y, width,height, maximized, minimized, fullscreen, id, title, log) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.maximized = maximized;
        this.minimized = minimized;
        // The following are only used for logging
        this.fullscreen = fullscreen;
        this.id = id;
        this.title = title;
        this.#log = log;
    }

    static fromWindow(window, log) {
        const rect = window.get_frame_rect();
        return new this (
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            window.get_maximized(),
            window.minimized,
            window.fullscreen,
            window.get_id(),
            window.get_title(),
            log,
        );
    }

    toString() {
        return `x:${this.x}, y:${this.y}, w:${this.width}, h:${this.height}, maximized:${this.maximized}, ` +
            `minimized:${this.minimized}, fullscreen:${this.fullscreen}, id:${this.id}, title:${this.title}`;
    }

    restore(currentWindow) {
        const equalRect = this.#equalRect(currentWindow);
        if (!equalRect) {
            if (currentWindow.get_maximized())
                currentWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            this.#moveResizeFrame(currentWindow);
        }
        this.#setMaximized(currentWindow);
        this.#setMinimized(currentWindow);
        this.#logDifferences(currentWindow);
        return equalRect;
    }

    #equalRect(window) {
        const r = window.get_frame_rect();
        return this.x === r.x && this.y === r.y &&
            this.width === r.width && this.height === r.height;
    }

    #moveResizeFrame(window) {
        // Is it correct to set user_op => true?  Is this performing a user operation?
        window.move_resize_frame(true, this.x, this.y, this.width, this.height);
    }

    #setMaximized(window) {
        if (window.get_maximized() !== this.maximized) {
            if (this.maximized)
                window.maximize(this.maximized);
            else
                window.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }

    #setMinimized(window) {
        if (window.minimized !== this.minimized) {
            if (this.minimized)
                window.minimize();
            else
                window.unminimize();
        }
    }

    #logDifferences(window) {
        let hasDiffs = false;
        if (window.minimized !== this.minimized) {
            this.#log.error(`Wrong minimized: ${window.minimized()}, title:${this.title}`);
            hasDiffs = true;
        }
        if (window.get_maximized() !== this.maximized) {
            this.#log.error(`Wrong maximized: ${window.get_maximized()}, title:${this.title}`);
            hasDiffs = true;
        }
        // This test fails when there is a difference between saved and current maximization, though the window
        // behaviour is correct.  Due to an asynchronous update?
        if (this.log >= LOG_EVERYTHING && !this.#equalRect(window)) {
            const r = window.get_frame_rect();
            this.#log.error(`Wrong rectangle: x:${r.x}, y:${r.y}, w:${r.width}, h:${r.height}, title:${this.title}`);
            hasDiffs = true;
        }
        if (hasDiffs)
            this.#log.error(`Expecting: ${this}`);
    }
}

class AllWindowsStates {
    #persist;
    #log;
    #windowsStates;
    constructor(uuid, log) {
        this.#persist = new Persist(uuid, log);
        this.#log = log;
        this.#windowsStates = null;
    }

    destroy() {
        (async () => {
            await this.saveWindowPositions('Disable: Save');
            await this.#saveWindowsStates();
            this.#windowsStates?.clear();
            this.#log.debug("AllWindowsStates destroy is done");
        })().catch (e => {
            this.#log.exception("AllWindowsStates destroy caught", e);
        });
    }

    async #getWindowsStates() {
        if (! this.#windowsStates) {
            if (windowStateSaved) {
                this.#windowsStates = await this.#persist.load().catch(e => {
                    this.#log.exception("#getWindowsStates caught", e);
                    return new Map();
                });
            } else {
                this.#windowsStates = new Map();
                this.#log.debug("Initializing windows states to empty because windowStateSaved is false");
            }
        }
        return this.#windowsStates;
    }

    async #saveWindowsStates() {
        if (this.#windowsStates) {
            if (await this.#persist.save(this.#windowsStates).catch(e => {
                this.#log.exception("#saveWindowsStates caught", e);
                return false;
            })) {
                windowStateSaved = true;
            } else {
                this.#log.error("Failed to save the windows states to the file");
            }
        }
    }

    #getWindows() {
        return global.get_window_actors().map(a => a.meta_window).filter(w => !w.is_skip_taskbar());
    }

    async #getWindowStateMap(why) {
        const size = global.display.get_size();
        const displaySizeKey = size[0] * 100000 + size[1];
        const displaySize__windowId__state = await this.#getWindowsStates();
        if (! displaySize__windowId__state.has(displaySizeKey)) {
            displaySize__windowId__state.set(displaySizeKey, new Map());
        }
        const windowId__state = displaySize__windowId__state.get(displaySizeKey);
        if (this.#log.debugp)
            this.#log.log(`${why}: map size: ${windowId__state.size}  display size: ${size}  start time: ${START_TIME}`);
        return windowId__state;
    }

    async saveWindowPositions(why) {
        const windowId__state = await this.#getWindowStateMap(why);
        windowId__state.clear();
        for (const window of this.#getWindows()) {
            const state = WindowState.fromWindow(window, this.#log);
            windowId__state.set(window.get_id(), state);
            if (LOG_DEFAULT >= LOG_INFO || this.#log.debugp)
                this.#log.log(`Save ${state}`);
        }
    }

    async restoreWindowPositions(why) {
        const windowId__state = await this.#getWindowStateMap(why);
        let restoreCount = 0;
        let changedRectCount = 0;
        for (const window of this.#getWindows()) {
            if (windowId__state.has(window.get_id())) {
                restoreCount++;
                if (!windowId__state.get(window.get_id()).restore(window))
                    changedRectCount++;
            } else if (this.#log.debugp)
                this.#log.log(`${why} did not find: ${window.get_id()} ${window.get_title()}`);
        }
        if (LOG_DEFAULT >= LOG_INFO || this.#log.debugp)
            this.#log.log(`${why}: ${changedRectCount}/${restoreCount} restored windows were moved`);
    }
}

// The code below is from the All Windows GNOME Shell extension (https://github.com/lyonel/all-windows) with these changes:
// * addition of _allWindowsStates code.
const WindowList = GObject.registerClass(
class WindowList extends PanelMenu.Button {

    _init(allWindowsStates, metadata, log) {
        super._init(0.0, metadata.name);
        this._log = log;

        (async () => {
            this._allWindowsStates = allWindowsStates;
            await this._allWindowsStates.restoreWindowPositions('Enable: Restore');
            this.add_child(new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' }));
            this.updateMenu();

            this._restacked = global.display.connect('restacked', () => this.updateMenu());
        })().catch (e => {
            this._log.exception("WindowList._init caught", e);
        });

        this.connect('event', this._onClicked.bind(this));
    }

    destroy() {
        global.display.disconnect(this._restacked);

        this._allWindowsStates = null;
        super.destroy();
    }

    _onClicked(actor, event) {
        // Check if it's a button click event
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN &&
             event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;

        if (event.get_button() !== 2) // check if it's middle click
            return Clutter.EVENT_PROPAGATE;
    
        this._allWindowsStates.restoreWindowPositions('Restore').catch (e => {console.error(`${EXTENSION_LOG_NAME}: Restore menu item caught:\n`, e);});

        return Clutter.EVENT_STOP;
    }

    updateMenu() {
        this.menu.removeAll();
        let empty_menu = true;

        let tracker = Shell.WindowTracker.get_default();
        {
            let item = new PopupMenu.PopupMenuItem('Save window positions');
            item.connect('activate', () => this._allWindowsStates.saveWindowPositions('Save')
                         .catch (e => {this._log.exception("Save menu item caught", e);}));
            this.menu.addMenuItem(item);

            item = new PopupMenu.PopupMenuItem('Restore window positions');
            item.connect('activate', () => this._allWindowsStates.restoreWindowPositions('Restore')
                         .catch (e => {this._log.exception("Restore menu item caught", e);}));
            this.menu.addMenuItem(item);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        for ( let wks=0; wks<global.workspace_manager.n_workspaces; ++wks ) {
            // construct a list with all windows
            let workspace_name = Meta.prefs_get_workspace_name(wks);
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(wks);
            let windows = metaWorkspace.list_windows();
            let sticky_windows = windows.filter(
                function(w) {
                    return !w.is_skip_taskbar() && w.is_on_all_workspaces();
                }
            );
            windows = windows.filter(
                function(w) {
                    return !w.is_skip_taskbar() && !w.is_on_all_workspaces();
                }
            );

            if(sticky_windows.length && (wks==0)) {
                for ( let i = 0; i < sticky_windows.length; ++i ) {
                    let metaWindow = sticky_windows[i];
                    let item = new PopupMenu.PopupMenuItem('');
                    item.connect('activate', () => this.activateWindow(metaWorkspace, metaWindow));
                    item._window = sticky_windows[i];
                    let app = tracker.get_window_app(item._window);
                    let box = new St.BoxLayout( { x_expand: true  } );
                    item._icon = app.create_icon_texture(24);
                    box.add_child(new St.Label({ text: ellipsizedWindowTitle(metaWindow), x_expand: true }));
                    box.add_child(new St.Label({ text: ' ' }));
                    box.add_child(item._icon);
                    item.add_child(box);
                    this.menu.addMenuItem(item);
                    empty_menu = false;
                }
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            if(windows.length) {
                if(wks>0) {
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                }
                if(global.workspace_manager.n_workspaces>1) {
                    let item = new PopupMenu.PopupMenuItem(workspace_name);
                    item.reactive = false;
                    item.can_focus = false;
                    if(wks == global.workspace_manager.get_active_workspace().index()) {
                        item.setOrnament(PopupMenu.Ornament.DOT);
                    }
                    this.menu.addMenuItem(item);
                    empty_menu = false;
                }


                for ( let i = 0; i < windows.length; ++i ) {
                    let metaWindow = windows[i];
                    let item = new PopupMenu.PopupMenuItem('');
                    item.connect('activate', () => this.activateWindow(metaWorkspace, metaWindow));
                    item._window = windows[i];
                    let app = tracker.get_window_app(item._window);
                    let box = new St.BoxLayout( { x_expand: true  } );
                    item._icon = app.create_icon_texture(24);
                    box.add_child(new St.Label({ text: ellipsizedWindowTitle(metaWindow), x_expand: true }));
                    box.add_child(new St.Label({ text: ' ' }));
                    box.add_child(item._icon);
                    item.add_child(box);
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
        }
        else {
            this.show();
        }
    }

    activateWindow(metaWorkspace, metaWindow) {
        if(!metaWindow.is_on_all_workspaces()) { metaWorkspace.activate(global.get_current_time()); }
        metaWindow.unminimize();
        metaWindow.activate(0);
    }

    _onButtonPress(actor, event) {
        this.updateMenu();
        this.parent(actor, event);
    }

});

function ellipsizeString(s, l){
    if(s.length > l) {
        return s.substr(0, l)+'...';
    }
    return s;
}

function ellipsizedWindowTitle(w){
    return ellipsizeString(w.get_title()||"-", 100);
}

export default class AllWindowsExtension extends Extension {

    #log;
    #allWindowsStates
    #windowlist

    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this.#log = new Log(this.getSettings());
        this.#log.debug("enable() starting");
        this.#allWindowsStates = new AllWindowsStates(this.metadata.uuid, this.#log);
        this.#windowlist = new WindowList(this.#allWindowsStates, this.metadata, this.#log);
        Main.panel.addToStatusArea(this.uuid, this.#windowlist, -1, 'right');
        this.#log.debug("enable() ending");
    }

    disable() {
        this.#log.debug("disable() starting");
        this.#windowlist?.destroy();
        this.#windowlist = null;
        this.#allWindowsStates?.destroy();
        this.#allWindowsStates = null;
        this.#log.debug("disable() ending");
        this.#log = null;
    }
}
