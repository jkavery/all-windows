#!/bin/bash

gdbus call --session --dest org.gnome.Shell --object-path /com/srwp/LoadSaveWindowPosition --method com.srwp.LoadSaveWindowPosition.savePosition 'dbus save'
gdbus call --session --dest org.gnome.Shell --object-path /com/srwp/LoadSaveWindowPosition --method com.srwp.LoadSaveWindowPosition.restorePosition 'dbus restore'
