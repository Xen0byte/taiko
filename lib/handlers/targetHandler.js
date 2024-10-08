const cri = require("chrome-remote-interface");
const url = require("node:url");
const path = require("node:path");
const { handleUrlRedirection, isString, isRegex } = require("../helper");
const { eventHandler } = require("../eventBus");
const { trimCharLeft, escapeHtml } = require("../util");
const { logEvent } = require("../logger");
const { defaultConfig } = require("../config");

let criTarget;
let browserDebugUrlTarget;
let activeBrowserContextId;
let activeTargetId;
const targetRegistry = new Map();
const browserRegistry = new Map();

const createdSessionListener = async (client, currentTarget) => {
  let resolve;
  eventHandler.emit(
    "handlerActingOnNewSession",
    new Promise((r) => {
      resolve = r;
    }),
  );
  criTarget = client.Target;
  activeTargetId = currentTarget.includes("/")
    ? currentTarget.split("/").pop()
    : currentTarget;
  activeBrowserContextId = await getBrowserContextIdForTarget(activeTargetId);
  browserDebugUrlTarget = (
    await cri({
      host: defaultConfig.host,
      port: defaultConfig.port,
      useHostName: defaultConfig.useHostName,
      secure: defaultConfig.secure,
      alterPath: defaultConfig.alterPath,
      local: defaultConfig.local,
      target: defaultConfig.browserDebugUrl,
    })
  ).Target;
  await criTarget.setDiscoverTargets({ discover: true });
  criTarget.targetCreated((target) => {
    if (target.targetInfo.type === "page") {
      if (target.targetInfo.openerId || defaultConfig.firefox) {
        logEvent(`Target Created: Target id: ${target.targetInfo.targetId}`);
        eventHandler.emit("targetCreated", target);
      }
    }
  });
  resolve();
};

eventHandler.on("createdSession", createdSessionListener);

const isMatchingRegex = (target, targetRegex) => {
  if (!isRegex(targetRegex)) {
    return false;
  }
  const parsedUrl = url.parse(target.url, true);
  const host = parsedUrl.host ? parsedUrl.host : "";
  const urlPath = path.join(host, trimCharLeft(parsedUrl.pathname, "/"));
  const urlHrefPath = parsedUrl.protocol
    .concat("//")
    .concat(trimCharLeft(host, "/"));

  return (
    target.title.match(targetRegex) ||
    urlPath.match(targetRegex) ||
    parsedUrl.href.match(targetRegex) ||
    urlHrefPath.match(targetRegex)
  );
};

const prependHttp = (targetUrl) => {
  return targetUrl && url.parse(targetUrl).host === null
    ? `http://${targetUrl}`
    : targetUrl;
};

const isMatchingUrl = (target, identifier) => {
  if (!isString(identifier)) {
    return false;
  }

  const _identifier = prependHttp(identifier);
  const parsedUrl = url.parse(target.url, true);
  const parsedTargetUrl = url.parse(_identifier, true);

  const host = parsedUrl.host ? parsedUrl.host : "";
  const targetHost = parsedTargetUrl.host ? parsedTargetUrl.host : "";

  const pathname = parsedUrl.pathname ? parsedUrl.pathname : "";
  const targetPathname = parsedTargetUrl.pathname
    ? parsedTargetUrl.pathname
    : "";

  const urlPath = path.join(host, pathname);
  const identifierPath = path.join(targetHost, targetPathname);

  target.url = handleUrlRedirection(target.url);
  return (
    target.title === escapeHtml(_identifier) ||
    urlPath === (identifierPath || _identifier) ||
    parsedUrl.href === _identifier
  );
};

const isMatchingTarget = (target, identifier) => {
  const storedTarget = register(identifier.name);
  return storedTarget && storedTarget === target.id;
};

const register = (name, target) => {
  if (name && target) {
    targetRegistry.set(name, target);
    browserRegistry.set(target, activeBrowserContextId);
  } else {
    return targetRegistry.get(name);
  }
};

const unregister = (name) => {
  browserRegistry.delete(targetRegistry.get(name));
  targetRegistry.delete(name);
};

const clearRegister = () => {
  browserRegistry.clear();
  targetRegistry.clear();
};

const createBrowserContext = async (url) => {
  const { browserContextId } =
    await browserDebugUrlTarget.createBrowserContext();
  activeBrowserContextId = browserContextId;
  return await createTarget(url);
};

const createTarget = async (url) => {
  const openWindowOptions = {
    url,
    browserContextId: activeBrowserContextId,
  };

  const createdTarget = await browserDebugUrlTarget
    .createTarget(openWindowOptions)
    .catch(async (error) => {
      if (
        error.response?.message &&
        (error.response.message.includes(
          "Failed to find browser context with id",
        ) ||
          error.response.message.includes("browserContextId"))
      ) {
        return await browserDebugUrlTarget.createTarget({ url });
      }
      throw error;
    });

  return createdTarget.targetId;
};

const closeTarget = async (targetId) => {
  await browserDebugUrlTarget.closeTarget({ targetId });
};

const closeBrowserContext = async (targetId) => {
  const browserContextId = browserRegistry.get(targetId)
    ? browserRegistry.get(targetId)
    : await getBrowserContextIdForTarget(targetId);
  await browserDebugUrlTarget.disposeBrowserContext({ browserContextId });
  return browserContextId === activeBrowserContextId;
};

const switchBrowserContext = async (targetId) => {
  activeBrowserContextId = await getBrowserContextIdForTarget(targetId);
  await browserDebugUrlTarget.activateTarget({ targetId: targetId.toString() });
};

const getBrowserContextIdForTarget = async (targetId) => {
  const { browserContextId } = (await criTarget.getTargetInfo({ targetId }))
    .targetInfo;
  return browserContextId;
};

const waitForTargetToBeCreated = async (n) => {
  try {
    const pages = await getFirstAvailablePageTarget();
    return pages[0].targetId;
  } catch (err) {
    logEvent(err);
    if (n < 2) {
      throw err;
    }
    return new Promise((r) => setTimeout(r, 100)).then(
      async () => await waitForTargetToBeCreated(n - 1),
    );
  }
};

const getFirstAvailablePageTarget = async () => {
  browserDebugUrlTarget = (
    await cri({
      host: defaultConfig.host,
      port: defaultConfig.port,
      useHostName: defaultConfig.useHostName,
      secure: defaultConfig.secure,
      alterPath: defaultConfig.alterPath,
      local: defaultConfig.local,
      target: defaultConfig.browserDebugUrl,
    })
  ).Target;
  const targets = (await browserDebugUrlTarget.getTargets()).targetInfos;
  const pages = targets.filter((target) => target.type === "page");
  if (!pages.length) {
    throw new Error("No targets created yet!");
  }
  return pages;
};

const getCriTargets = async (identifier) => {
  const pages = await getFirstAvailablePageTarget();
  if (!identifier) {
    return {
      matching: pages.filter((target) => target.targetId === activeTargetId),
      others: pages.filter((target) => target.targetId !== activeTargetId),
    };
  }
  const response = { matching: [], others: [] };
  for (const target of pages) {
    if (
      isMatchingUrl(target, identifier) ||
      isMatchingRegex(target, identifier) ||
      isMatchingTarget(target, identifier)
    ) {
      response.matching.push(target);
    } else {
      response.others.push(target);
    }
  }
  return response;
};

module.exports = {
  getCriTargets,
  isMatchingUrl,
  isMatchingRegex,
  isMatchingTarget,
  register,
  unregister,
  clearRegister,
  createBrowserContext,
  closeBrowserContext,
  switchBrowserContext,
  waitForTargetToBeCreated,
  createTarget,
  getFirstAvailablePageTarget,
  closeTarget,
};
