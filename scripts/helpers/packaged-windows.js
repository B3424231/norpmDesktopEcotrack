'use strict';
// A packaged process can show a startup window before creating its main renderer.
async function waitForMainPage(application, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = application.windows().find(window => /\/login\.html(?:\?|$)/.test(window.url()));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The packaged main login renderer did not become ready.');
}
module.exports = { waitForMainPage };
