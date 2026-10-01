(() => {
  const { before, after } = vendetta.patcher;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { React } = vendetta.metro.common;
  const { findInReactTree } = vendetta.utils;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { showInputAlert } = vendetta.ui.alerts;
  const { storage } = vendetta.plugin;
  const logger = vendetta.logger;

  const FluxDispatcher = vendetta.metro.common.FluxDispatcher;
  const ActionSheet = findByProps("openLazy", "hideActionSheet");
  const ActionSheetRow = findByProps("ActionSheetRow")?.ActionSheetRow;
  const MessageStore = findByStoreName("MessageStore");
  const MessageActions =
    findByProps("fetchMessages", "sendMessage") ??
    findByProps("jumpToMessage");

  const PREFIX = "🎭 已玩｜";
  const SUFFIX = " 〔长按展开〕";

  const unpatches = [];
  let unpatchSheet = null;
  let active = false;

  storage.records ??= {};

  const later = (fn, ms = 0) =>
    setTimeout(() => {
      try { fn(); } catch (e) { logger.error("[SceneFold]", e); }
    }, ms);

  const clone = value => {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) {
      try { return { ...value }; }
      catch (_) { return value; }
    }
  };

  const records = () => {
    if (!storage.records || typeof storage.records !== "object" || Array.isArray(storage.records)) {
      storage.records = {};
    }
    return storage.records;
  };

  const channelIdOf = m => m?.channel_id ?? m?.channelId;

  const keyOf = m => {
    const channelId = channelIdOf(m);
    const id = m?.id;
    return channelId && id ? `${channelId}:${id}` : null;
  };

  const getRecord = m => {
    const key = keyOf(m);
    return key ? records()[key] : undefined;
  };

  const refreshActive = () => {
    active = Object.values(records()).some(r => r?.collapsed);
  };

  const snapshotsOf = m =>
    m?.message_snapshots ??
    m?.messageSnapshots ??
    m?.rawData?.message_snapshots ??
    m?.rawData?.messageSnapshots;

  const extractText = m => {
    const snapshotMessage = snapshotsOf(m)?.[0]?.message;
    const candidates = [
      m?.content,
      snapshotMessage?.content,
      m?.embeds?.[0]?.description,
      snapshotMessage?.embeds?.[0]?.description,
      m?.embeds?.[0]?.title,
      snapshotMessage?.embeds?.[0]?.title,
    ];

    const raw = candidates.find(v => typeof v === "string" && v.trim()) || "";

    return raw
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*_~`>#|\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const autoSummary = m => {
    const text = extractText(m);
    if (!text) return "已玩小剧场";
    return text.length > 46 ? `${text.slice(0, 46)}…` : text;
  };

  const foldedLine = record =>
    `${PREFIX}${record?.summary || "已玩小剧场"}${SUFFIX}`;

  function normalizeOriginal(message) {
    const copy = clone(message) || {};

    copy.id = message.id;
    copy.channel_id = channelIdOf(message);

    if (!copy.author && message.author) copy.author = clone(message.author);
    if (!copy.timestamp) copy.timestamp = message.timestamp || new Date().toISOString();
    if (copy.content == null) copy.content = message.content ?? "";

    return copy;
  }

  function makeFoldedMessage(message, record) {
    const fake = normalizeOriginal(message);

    fake.content = foldedLine(record);

    fake.embeds = [];
    fake.attachments = [];
    fake.components = [];
    fake.sticker_items = [];
    fake.stickerItems = [];
    fake.reactions = fake.reactions ?? [];

    // Forwarded-message payloads are what Discord 347.12 actually renders.
    // Remove both known spellings and force this local copy to render as a normal text message.
    fake.message_snapshots = [];
    fake.messageSnapshots = [];

    if (fake.rawData && typeof fake.rawData === "object") {
      fake.rawData = clone(fake.rawData);
      fake.rawData.content = fake.content;
      fake.rawData.embeds = [];
      fake.rawData.attachments = [];
      fake.rawData.components = [];
      fake.rawData.sticker_items = [];
      fake.rawData.message_snapshots = [];
      fake.rawData.messageSnapshots = [];
      fake.rawData.type = 0;
      fake.rawData.flags = 0;
    }

    fake.type = 0;
    fake.flags = 0;
    fake.referenced_message = null;
    fake.referencedMessage = null;
    fake.message_reference = null;
    fake.messageReference = null;

    return fake;
  }

  function dispatchDelete(id, channelId) {
    FluxDispatcher.dispatch({
      type: "MESSAGE_DELETE",
      id,
      channelId,
      __sceneFold: true,
    });
  }

  function dispatchCreate(message) {
    const channelId = channelIdOf(message);

    FluxDispatcher.dispatch({
      type: "MESSAGE_CREATE",
      channelId,
      message,
      optimistic: false,
      local: true,
      silent: true,
      __sceneFold: true,
    });
  }

  function replaceLoadedWithFolded(message, record) {
    const channelId = channelIdOf(message);
    const id = message?.id;
    if (!channelId || !id) return;

    const fake = makeFoldedMessage(message, record);

    dispatchDelete(id, channelId);
    later(() => dispatchCreate(fake), 25);
  }

  function replaceLoadedWithOriginal(message, record) {
    const channelId = channelIdOf(message);
    const id = message?.id;
    if (!channelId || !id) return false;

    const original = clone(record?.originalMessage);
    if (!original?.id) return false;

    original.channel_id = channelId;

    dispatchDelete(id, channelId);
    later(() => dispatchCreate(original), 25);
    return true;
  }

  function reloadAround(channelId, messageId) {
    try {
      if (MessageActions?.fetchMessages) {
        MessageActions.fetchMessages({
          channelId,
          limit: 50,
          jump: { messageId, flash: false },
        });
        return true;
      }

      if (MessageActions?.jumpToMessage) {
        MessageActions.jumpToMessage({
          channelId,
          messageId,
          flash: false,
        });
        return true;
      }
    } catch (e) {
      logger.error("[SceneFold] reloadAround failed", e);
    }

    return false;
  }

  function ensureOriginal(record, message) {
    if (!record.originalMessage && message) {
      record.originalMessage = normalizeOriginal(message);
    }
  }

  function fold(message) {
    const key = keyOf(message);
    if (!key) return;

    const current =
      MessageStore?.getMessage?.(channelIdOf(message), message.id) ??
      message;

    let record = records()[key];

    if (!record) {
      record = records()[key] = {
        summary: autoSummary(current),
        collapsed: true,
        createdAt: Date.now(),
        originalMessage: normalizeOriginal(current),
      };
    } else {
      ensureOriginal(record, current);
      record.summary ||= autoSummary(current);
      record.collapsed = true;
    }

    refreshActive();
    replaceLoadedWithFolded(current, record);
    showToast("已标记为已玩并折叠", getAssetIDByName("Check"));
  }

  function expand(message) {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = false;
    refreshActive();

    const ok = replaceLoadedWithOriginal(message, record);

    if (!ok) {
      reloadAround(channelIdOf(message), message.id);
    }

    showToast("已展开原文", getAssetIDByName("Check"));
  }

  function refold(message) {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = true;
    refreshActive();

    const current =
      MessageStore?.getMessage?.(channelIdOf(message), message.id) ??
      message;

    replaceLoadedWithFolded(current, record);
    showToast("已重新折叠", getAssetIDByName("Check"));
  }

  function unmark(message) {
    const key = keyOf(message);
    const record = key ? records()[key] : undefined;
    if (!key || !record) return;

    record.collapsed = false;

    const ok = replaceLoadedWithOriginal(message, record);
    delete records()[key];
    refreshActive();

    if (!ok) {
      reloadAround(channelIdOf(message), message.id);
    }

    showToast("已取消已玩标记", getAssetIDByName("Check"));
  }

  function editSummary(message) {
    const record = getRecord(message);
    if (!record) return;

    showInputAlert({
      title: "编辑小剧场摘要",
      initialValue: record.summary || "",
      placeholder: "例如：雨夜车内 · 吃醋后和好 · 甜",
      confirmText: "保存",
      cancelText: "取消",
      onConfirm: value => {
        const summary = String(value || "").replace(/\s+/g, " ").trim();
        if (!summary) return;

        record.summary =
          summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;

        if (record.collapsed) {
          const current =
            MessageStore?.getMessage?.(channelIdOf(message), message.id) ??
            message;

          replaceLoadedWithFolded(current, record);
        }
      },
    });
  }

  // Intercept messages before Discord stores/renders them.
  // This is the important v0.1.2 change: forwarded snapshots are replaced before
  // the 347.12 forwarded-message renderer ever sees them.
  function transformMessage(message) {
    if (!message?.id) return message;

    const record = getRecord(message);
    if (!record?.collapsed) return message;

    ensureOriginal(record, message);
    return makeFoldedMessage(message, record);
  }

  function transformList(list) {
    return list.map(item => {
      if (Array.isArray(item)) return transformList(item);
      return transformMessage(item);
    });
  }

  function interceptor(action) {
    if (!active || !action?.type || action.__sceneFold) return false;

    try {
      if (
        action.message?.id &&
        (
          action.type === "MESSAGE_CREATE" ||
          action.type === "MESSAGE_UPDATE"
        )
      ) {
        action.message = transformMessage(action.message);
      }

      if (Array.isArray(action.messages)) {
        action.messages = transformList(action.messages);
      }
    } catch (e) {
      logger.error("[SceneFold] interceptor failed", e);
    }

    return false;
  }

  const isRow = el =>
    el?.props &&
    typeof el.props.label === "string" &&
    typeof el.props.onPress === "function";

  function makeRow(template, key, label, iconName, onPress) {
    const props = { key, label, onPress };
    const iconId = getAssetIDByName?.(iconName);
    const icon = template?.props?.icon;

    if (iconId && React.isValidElement(icon)) {
      props.icon = React.cloneElement(icon, { source: iconId });
    } else if (iconId && typeof icon === "number") {
      props.icon = iconId;
    }

    return React.cloneElement(template, props);
  }

  function addRows(tree, message) {
    const rows = findInReactTree(
      tree,
      x => Array.isArray(x) && x.some(isRow)
    );

    if (!rows || rows.some(r => r?.key === "scenefold-fold")) return;

    const template = rows.find(isRow);
    if (!template) return;

    const close = () => ActionSheet?.hideActionSheet?.();
    const record = getRecord(message);

    if (!record) {
      rows.splice(
        1,
        0,
        makeRow(
          template,
          "scenefold-fold",
          "🎭 标记已玩并折叠",
          "ArchiveIcon",
          () => {
            close();
            fold(message);
          }
        )
      );
      return;
    }

    rows.splice(
      1,
      0,
      makeRow(
        template,
        "scenefold-toggle",
        record.collapsed
          ? "📖 展开已玩小剧场"
          : "🎭 收起已玩小剧场",
        record.collapsed ? "EyeIcon" : "ArchiveIcon",
        () => {
          close();
          record.collapsed ? expand(message) : refold(message);
        }
      ),
      makeRow(
        template,
        "scenefold-summary",
        "✏️ 编辑一句话摘要",
        "PencilIcon",
        () => {
          close();
          editSummary(message);
        }
      ),
      makeRow(
        template,
        "scenefold-unmark",
        "取消已玩标记",
        "TrashIcon",
        () => {
          close();
          unmark(message);
        }
      )
    );
  }

  function patchSheet() {
    if (!ActionSheet) return;

    unpatches.push(
      before("openLazy", ActionSheet, ([lazy, key]) => {
        if (
          unpatchSheet ||
          typeof key !== "string" ||
          !key.includes("MessageLongPress")
        ) return;

        Promise.resolve(lazy).then(mod => {
          if (unpatchSheet || !mod) return;

          const target =
            typeof mod.default === "function"
              ? mod
              : typeof mod.default?.type === "function"
                ? mod.default
                : null;

          const prop =
            typeof mod.default === "function"
              ? "default"
              : typeof mod.default?.type === "function"
                ? "type"
                : null;

          if (!target || !prop) return;

          unpatchSheet = after(prop, target, ([props], tree) => {
            try {
              if (props?.message?.id) {
                addRows(tree, props.message);
              }
            } catch (e) {
              logger.error("[SceneFold] couldn't add menu rows", e);
            }
          });
        });
      })
    );
  }

  function applyToLoaded() {
    for (const [key, record] of Object.entries(records())) {
      if (!record?.collapsed) continue;

      const colon = key.indexOf(":");
      if (colon < 0) continue;

      const channelId = key.slice(0, colon);
      const id = key.slice(colon + 1);
      const message = MessageStore?.getMessage?.(channelId, id);

      if (!message) continue;

      ensureOriginal(record, message);
      replaceLoadedWithFolded(message, record);
    }
  }

  return {
    onLoad() {
      refreshActive();

      if (FluxDispatcher?._interceptors) {
        FluxDispatcher._interceptors.unshift(interceptor);
        unpatches.push(() => {
          if (FluxDispatcher?._interceptors) {
            FluxDispatcher._interceptors =
              FluxDispatcher._interceptors.filter(i => i !== interceptor);
          }
        });
      } else {
        logger.error("[SceneFold] FluxDispatcher interceptors unavailable");
      }

      patchSheet();
      later(applyToLoaded, 100);

      logger.log("[SceneFold] v0.1.2 loaded");
    },

    onUnload() {
      for (const [key, record] of Object.entries(records())) {
        if (!record?.collapsed) continue;

        const colon = key.indexOf(":");
        if (colon < 0) continue;

        const channelId = key.slice(0, colon);
        const id = key.slice(colon + 1);
        const message = MessageStore?.getMessage?.(channelId, id);

        if (message) {
          replaceLoadedWithOriginal(message, record);
        }
      }

      unpatchSheet?.();
      unpatchSheet = null;

      unpatches.splice(0).forEach(unpatch => {
        try { unpatch?.(); } catch (_) {}
      });

      logger.log("[SceneFold] unloaded");
    },
  };
})()
