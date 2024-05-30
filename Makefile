all: all-windows@ezix.org.shell-extension.zip

all-windows@ezix.org.shell-extension.zip: COPYING README.md extension.js favicon.png favicon.svg metadata.json
	gnome-extensions pack --force
