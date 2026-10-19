/**
 * Decide which links the desktop window may hand to the system browser.
 * The window itself never navigates away from the local app; web and mail
 * links open in the user's default browser or mail app instead.
 */
function externalUrlToOpen(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    // Not a URL; never open it.
  }
  return null;
}

module.exports = { externalUrlToOpen };
