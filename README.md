All Windows + Save/Restore Window Positions extension for GNOME Shell
=====================================================================

About
-----
The All Windows functionality is a port by lyonel of his Cinnamon applet (now included in Cinnamon 1.6+).

It displays a menu listing all open windows on all workspaces on the right-hand side of the GNOME top bar and allows quickly switching between them.

Save/Restore window positions additional functionality
------------------------------------------------------
At the top of the menu, preceding the listing of open windows, are two buttons: *Save window positions* and *Restore window positions*.

The buttons are used to remember and restore the positions of the open windows in the display.  The set of window positions is associated with the current display size, which can change when monitors are added or removed.  Each display size has its own set of window positions.

In addition, window positions are automatically saved when the computer is suspended and restored when it is resumed.  This provides a workaround for [Bug #1778983 “Resume from suspend on Wayland breaks window positioning” : Bugs : mutter package : Ubuntu](https://bugs.launchpad.net/ubuntu/+source/mutter/+bug/1778983).  The problem remains in Ubuntu 22.04.

### Limitations
 * Restore does not manage which windows are on top.  However, in testing to date the correct windows have always been shown on top.
 * When a password is required after a suspend, enough time typically passes for the restore to happen automatically.  If not, *Restore window positions* must manually be pressed.
 * Save/restore does not work across reboots.

Configuration
-------------
There is nothing to configure.

Installation
------------
To install this extension you can either
 * use the [GNOME Extensions hub](https://extensions.gnome.org/extension/4833/all-windows-saverestore-window-positions/) (caution: it doesn't always contain the most recent versions)
 * copy it under `~/.local/share/gnome-shell/extensions/all-windows-srwp@jkavery.github.io/` in your home directory

Note: you may have to explicitly enable the extension after installation.

Compatibility
-------------
This extension has been tested on GNOME 3.38, 40, 42, 45 and 46.

License
-------
This extension is released under the GNU Public License version 2.
