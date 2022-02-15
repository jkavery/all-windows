#!/bin/sh

BASEDIR=.local/share/gnome-shell/extensions
DIR=all-windows-srwp@ezix.org
URL=https://github.com/jkavery/all-windows.git

which git 2> /dev/null > /dev/null || ( echo Could not find Git ; exit 1 )
which gnome-shell 2> /dev/null > /dev/null || ( echo Could not find GNOME Shell ; exit 1 )

GSVERSION=$(gnome-shell --version | awk '{ print $3; }')

case $GSVERSION in
3.6|3.6.*)
	BRANCH="--branch 3.6-3.8"
	;;
3.8|3.8.*)
	BRANCH="--branch 3.6-3.8"
	;;
*)
	BRANCH=""
	;;
esac

cd $HOME
mkdir -p ${BASEDIR} 2> /dev/null

cd ${BASEDIR} || ( echo Could not change to ${BASEDIR} ; exit 2 )

echo Using ${HOME}/${BASEDIR}/${DIR}

if [ -d ${DIR}/.git ]; then
	echo Already installed, updating...
	cd ${DIR}
	git pull
else
	if [ -d ${DIR} ]; then
		echo Found a previous installation.
		echo If you are sure you want to replace it, please delete this folder and retry.
		exit 4
	else
		git clone ${BRANCH} ${URL} ${DIR} || exit 3
	fi
fi

echo "Restart GNOME-Shell.  For Wayland, logout and login.  For X: killall -HUP gnome-shell"
