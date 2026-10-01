(() => {
  const { before, after } = vendetta.patcher;
  const { findByProps, findByStoreName, findByName } = vendetta.metro;
  const { React, ReactNative, FluxDispatcher, stylesheet } = vendetta.metro.common;
  const { findInReactTree } = vendetta.utils;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { showInputAlert } = vendetta.ui.alerts;
  const storage = vendetta.plugin.storage;
  const logger = vendetta.logger;

  const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
  const ActionSheetRow = findByProps("ActionSheetRow")?.ActionSheetRow;
  const MessageStore = findByStoreName("MessageStore") || findByProps("getMessage", "getMessages");
  const ChannelStore = findByStoreName("ChannelStore") || findByProps("getChannel", "getDMFromUserId");
  const ChatItemModule = findByProps("DCDAutoModerationSystemMessageView", "default");
  const MessageRecord = findByName?.("MessageRecord");

  const PREFIX = "🎭 已玩｜";
  const SUFFIX = " 〔长按展开〕";
  const ZWSP = "\u200b";
  const patches = [];
  const pending = new Set();

  const styles = stylesheet?.createThemedStyleSheet?.({
    icon: { width: 24, height: 24 }
  }) || { icon: { width: 24, height: 24 } };

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

  const snapshotsOf = m =>
    m?.message_snapshots ??
    m?.messageSnapshots ??
    m?.rawData?.message_snapshots ??
    m?.rawData?.messageSnapshots;

  const extractText = m => {
    const snapshots = snapshotsOf(m);
    const firstSnapshotMessage = snapshots?.[0]?.message;

    const candidates = [
      m?.content,
      firstSnapshotMessage?.content,
      m?.embeds?.[0]?.description,
      firstSnapshotMessage?.embeds?.[0]?.description,
      m?.embeds?.[0]?.title,
      firstSnapshotMessage?.embeds?.[0]?.title
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

  const foldedLine = record => `${PREFIX}${record.summary || "已玩小剧场"}${SUFFIX}`;

  const snapshotOriginal = m => ({
    content: String(m?.content ?? "").replace(/\u200b/g, ""),
    message_snapshots: clone(m?.message_snapshots),
    messageSnapshots: clone(m?.messageSnapshots),
    embeds: clone(m?.embeds),
    attachments: clone(m?.attachments),
    components: clone(m?.components),
    sticker_items: clone(m?.sticker_items),
    stickerItems: clone(m?.stickerItems),
  });

  const clearForwardedPayload = target => {
    if ("message_snapshots" in target) target.message_snapshots = [];
    if ("messageSnapshots" in target) target.messageSnapshots = [];

    if (target.rawData && typeof target.rawData === "object") {
      target.rawData = clone(target.rawData);
      if ("message_snapshots" in target.rawData) target.rawData.message_snapshots = [];
      if ("messageSnapshots" in target.rawData) target.rawData.messageSnapshots = [];
    }
  };

  const makeFoldedMessage = (message, record) => {
    const data = clone(message) || {};
    const channelId = channelIdOf(message);

    data.id = message.id;
    data.channel_id = channelId;
    if (message.channelId != null) data.channelId = message.channelId;

    data.content = foldedLine(record);
    data.embeds = [];
    data.attachments = [];
    data.components = [];
    data.sticker_items = [];
    data.stickerItems = [];

    clearForwardedPayload(data);

    try {
      return MessageRecord ? new MessageRecord(data) : data;
    } catch (error) {
      logger.error("[SceneFold] MessageRecord build failed", error);
      return data;
    }
  };

  const dispatchFullMessage = (message, contentOverride, reason) => {
    const channelId = channelIdOf(message);
    const id = message?.id;

    if (!channelId || !id) return;

    const current = MessageStore?.getMessage?.(channelId, id) || message;
    const pendingKey = `${channelId}:${id}:${reason}`;

    if (pending.has(pendingKey)) return;
    pending.add(pendingKey);

    setTimeout(() => {
      try {
        const modified = clone(current) || {};
        modified.id = id;
        modified.channel_id = channelId;
        modified.guild_id =
          modified.guild_id ??
          ChannelStore?.getChannel?.(channelId)?.guild_id;

        if (contentOverride !== undefined) {
          modified.content = contentOverride;
        }

        FluxDispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: modified,
          log_edit: false,
          otherPluginBypass: true,
          __sceneFold: true,
        });
      } catch (error) {
        logger.error("[SceneFold] local refresh failed", error);
      } finally {
        pending.delete(pendingKey);
      }
    }, 0);
  };

  const refreshCollapsed = (message, record, reason) => {
    const originalContent = String(record?.original?.content ?? "").replace(/\u200b/g, "");
    dispatchFullMessage(message, originalContent + ZWSP, reason);
  };

  const refreshExpanded = (message, record, reason) => {
    const originalContent = String(record?.original?.content ?? "").replace(/\u200b/g, "");
    dispatchFullMessage(message, originalContent, reason);
  };

  const fold = message => {
    const key = keyOf(message);
    if (!key) return;

    const current = MessageStore?.getMessage?.(channelIdOf(message), message.id) || message;
    let record = records()[key];

    if (!record) {
      record = records()[key] = {
        summary: autoSummary(current),
        collapsed: true,
        createdAt: Date.now(),
        original: snapshotOriginal(current),
      };
    } else {
      record.collapsed = true;
    }

    refreshCollapsed(current, record, "fold");
    showToast("已标记为已玩并折叠", getAssetIDByName("Check"));
  };

  const expand = message => {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = false;
    refreshExpanded(message, record, "expand");
    showToast("已展开原文", getAssetIDByName("Check"));
  };

  const refold = message => {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = true;
    refreshCollapsed(message, record, "refold");
    showToast("已重新折叠", getAssetIDByName("Check"));
  };

  const unmark = message => {
    const key = keyOf(message);
    const record = key ? records()[key] : undefined;

    if (!key || !record) return;

    record.collapsed = false;
    refreshExpanded(message, record, "unmark");
    delete records()[key];

    showToast("已取消已玩标记", getAssetIDByName("Check"));
  };

  const editSummary = message => {
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

        record.summary = summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;

        if (record.collapsed) {
          refreshCollapsed(message, record, "summary");
        }
      },
    });
  };

  const patchMessageRenderer = () => {
    if (!ChatItemModule?.default) return null;

    return before("default", ChatItemModule, args => {
      const props = args?.[0];
      const message = props?.message;
      const record = message ? getRecord(message) : undefined;

      if (!message || !record?.collapsed) return;

      try {
        props.message = makeFoldedMessage(message, record);
      } catch (error) {
        logger.error("[SceneFold] render override failed", error);
      }
    });
  };

  const replayLoaded = () => {
    for (const [key, record] of Object.entries(records())) {
      if (!record?.collapsed) continue;

      const separatorIndex = key.indexOf(":");
      if (separatorIndex < 0) continue;

      const channelId = key.slice(0, separatorIndex);
      const id = key.slice(separatorIndex + 1);
      const message = MessageStore?.getMessage?.(channelId, id);

      if (message) {
        refreshCollapsed(message, record, "startup");
      }
    }
  };

  const makeIcon = name => {
    if (!ActionSheetRow?.Icon) return undefined;

    const source =
      getAssetIDByName(name) ||
      getAssetIDByName("Check") ||
      getAssetIDByName("ic_check");

    return React.createElement(ActionSheetRow.Icon, {
      source,
      IconComponent: () => React.createElement(ReactNative.Image, {
        source,
        resizeMode: "contain",
        style: styles.icon,
      }),
    });
  };

  const makeRow = (key, label, iconName, onPress) =>
    React.createElement(ActionSheetRow, {
      key,
      label,
      icon: makeIcon(iconName),
      onPress: () => {
        LazyActionSheet.hideActionSheet();
        onPress();
      },
    });

  const patchActionSheet = () =>
    before("openLazy", LazyActionSheet, ([component, sheetKey, props]) => {
      if (
        typeof sheetKey !== "string" ||
        !sheetKey.endsWith("MessageLongPressActionSheet")
      ) return;

      const message = props?.message;
      if (!message || !component?.then || !ActionSheetRow) return;

      component
        .then(instance => {
          const unpatch = after("default", instance, (_, tree) => {
            React.useEffect(
              () => () => {
                try { unpatch(); } catch (_) {}
              },
              []
            );

            const groups = findInReactTree(
              tree,
              value =>
                Array.isArray(value) &&
                value[0]?.type?.name === "ActionSheetRowGroup"
            );

            let buttons = null;

            if (groups?.length) {
              for (const group of groups) {
                buttons = findInReactTree(
                  group,
                  value =>
                    Array.isArray(value) &&
                    value.some(child => child?.type?.name === "ActionSheetRow")
                );
                if (buttons) break;
              }
            }

            if (!buttons) {
              buttons = findInReactTree(
                tree,
                value =>
                  Array.isArray(value) &&
                  value.some(child => child?.type?.name === "ActionSheetRow")
              );
            }

            if (!buttons) return;

            if (
              buttons.some(child =>
                String(child?.key || "").startsWith("scenefold-")
              )
            ) return;

            const record = getRecord(message);
            const rows = [];

            if (!record) {
              rows.push(
                makeRow(
                  "scenefold-fold",
                  "🎭 标记已玩并折叠",
                  "ArchiveIcon",
                  () => fold(message)
                )
              );
            } else {
              rows.push(
                makeRow(
                  "scenefold-toggle",
                  record.collapsed
                    ? "📖 展开已玩小剧场"
                    : "🎭 收起已玩小剧场",
                  record.collapsed ? "EyeIcon" : "ArchiveIcon",
                  () => record.collapsed ? expand(message) : refold(message)
                )
              );

              rows.push(
                makeRow(
                  "scenefold-summary",
                  "✏️ 编辑一句话摘要",
                  "PencilIcon",
                  () => editSummary(message)
                )
              );

              rows.push(
                makeRow(
                  "scenefold-unmark",
                  "取消已玩标记",
                  "TrashIcon",
                  () => unmark(message)
                )
              );
            }

            buttons.splice(1, 0, ...rows);
          });
        })
        .catch(error => {
          logger.error("[SceneFold] action-sheet patch failed", error);
        });
    });

  return {
    onLoad() {
      records();

      if (!LazyActionSheet || !FluxDispatcher || !MessageStore || !ActionSheetRow) {
        showToast("SceneFold 加载失败：找不到 Discord 消息组件");
        return;
      }

      patches.push(patchActionSheet());

      const renderPatch = patchMessageRenderer();
      if (renderPatch) patches.push(renderPatch);

      replayLoaded();
      logger.log("[SceneFold] v0.1.1 loaded");
    },

    onUnload() {
      for (const [key, record] of Object.entries(records())) {
        if (!record?.collapsed) continue;

        const separatorIndex = key.indexOf(":");
        if (separatorIndex < 0) continue;

        const channelId = key.slice(0, separatorIndex);
        const id = key.slice(separatorIndex + 1);
        const message = MessageStore?.getMessage?.(channelId, id);

        if (message) refreshExpanded(message, record, "unload");
      }

      for (const unpatch of patches.splice(0)) {
        try { unpatch?.(); } catch (_) {}
      }

      logger.log("[SceneFold] unloaded");
    },
  };
})()
