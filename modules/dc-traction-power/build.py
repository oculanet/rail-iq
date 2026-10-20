"""Build the single-file HTML model: inlines engine.js, readers.js and app.js into page.html."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
src = lambda n: open(os.path.join(HERE, "src", n), encoding="utf-8").read()
page = src("page.html")
for tag, name in (("/*__ENGINE__*/", "engine.js"), ("/*__READERS__*/", "readers.js"), ("/*__APP__*/", "app.js"), ("/*__STUDIES__*/", "studies_ui.js")):
    page = page.replace(tag, src(name))
# fragment for publishing as a claude.ai artifact (the host adds doctype/head)
art = os.path.join(HERE, "out", "TPS_Model_artifact.html")
os.makedirs(os.path.dirname(art), exist_ok=True)
open(art, "w", encoding="utf-8").write(page)
# standalone file to open from disk
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
out = os.path.join(HERE, "TPS_Model.html")
open(out, "w", encoding="utf-8").write(full)
print("built", out, len(full), "bytes and", art)
