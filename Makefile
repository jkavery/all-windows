all: all-windows-srwp@jkavery.github.io.shell-extension.zip schemas/gschemas.compiled

all-windows-srwp@jkavery.github.io.shell-extension.zip: COPYING README.md extension.js favicon.png favicon.svg metadata.json
	gnome-extensions pack --force $$(for f in $^; do echo --extra-source=$$f; done)

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.all-windows-srwp.gschema.xml
	glib-compile-schemas schemas/
