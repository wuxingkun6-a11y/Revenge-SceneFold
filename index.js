(() => {
  const { before, after } = vendetta.patcher;
  const { findByProps, findByStoreName } = vendetta.metro;
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

  const PREFIX = "🎭 已玩｜";
  const SUFFIX = " 〔长按展开〕";
  const patches = [];
  const pending = new Set();

  const styles = stylesheet?.createThemedStyleSheet?.({
    icon: { width: 24, height: 24 }
  }) || { icon: { width: 24, height: 24 } };

  const clone = value => {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
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

  const extractText = m => {
    const candidates = [
      m?.content,
      m?.message_snapshots?.[0]?.message?.content,
      m?.messageSnapshots?.[0]?.message?.content,
      m?.embeds?.[0]?.description,
      m?.message_snapshots?.[0]?.message?.embeds?.[0]?.description,
      m?.embeds?.[0]?.title,
      m?.message_snapshots?.[0]?.message?.embeds?.[0]?.title
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
    content: m?.content ?? "",
    message_snapshots: clone(m?.message_snapshots),
    embeds: clone(m?.embeds),
    attachments: clone(m?.attachments),
    components: clone(m?.components),
    sticker_items: clone(m?.sticker_items),
  });

  const makeFoldPatch = record => {
    const original = record.original || {};

    const patch = {
      content: foldedLine(record),
      embeds: [],
      attachments: [],
      components: [],
      sticker_items: [],
    };

    if (Array.isArray(original.message_snapshots) && original.message_snapshots.length) {
      const snapshots = clone(original.message_snapshots);

      for (const snapshot of snapshots) {
        if (!snapshot?.message) continue;

        snapshot.message.content = foldedLine(record);
        snapshot.message.embeds = [];
        snapshot.message.attachments = [];
        snapshot.message.components = [];
        snapshot.message.sticker_items = [];
      }

      patch.content = "";
      patch.message_snapshots = snapshots;
    }

    return patch;
  };

  const makeRestorePatch = record => {
    const original = record.original || {};

    return {
      content: original.content ?? "",
      message_snapshots: clone(original.message_snapshots),
      embeds: clone(original.embeds) ?? [],
      attachments: clone(original.attachments) ?? [],
      components: clone(original.components) ?? [],
      sticker_items: clone(original.sticker_items) ?? [],
    };
  };

  const dispatchUpdate = (message, patch, reason) => {
    const channelId = channelIdOf(message);
    const id = message?.id;

    if (!channelId || !id) return;

    const pendingKey = `${channelId}:${id}:${reason}`;
    if (pending.has(pendingKey)) return;

    pending.add(pendingKey);

    setTimeout(() => {
      try {
        FluxDispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: {
            id,
            channel_id: channelId,
            guild_id: ChannelStore?.getChannel?.(channelId)?.guild_id,
            ...patch,
          },
          log_edit: false,
          otherPluginBypass: true,
          __sceneFold: true,
        });
      } catch (error) {
        logger.error("SceneFold local update failed", error);
      } finally {
        pending.delete(pendingKey);
      }
    }, 0);
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

    dispatchUpdate(current, makeFoldPatch(record), "fold");
    showToast("已标记为已玩并折叠", getAssetIDByName("Check"));
  };

  const expand = message => {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = false;
    dispatchUpdate(message, makeRestorePatch(record), "expand");
    showToast("已展开原文", getAssetIDByName("Check"));
  };

  const refold = message => {
    const record = getRecord(message);
    if (!record) return;

    record.collapsed = true;
    dispatchUpdate(message, makeFoldPatch(record), "refold");
    showToast("已重新折叠", getAssetIDByName("Check"));
  };

  const unmark = message => {
    const key = keyOf(message);
    const record = key ? records()[key] : undefined;

    if (!key || !record) return;

    dispatchUpdate(message, makeRestorePatch(record), "unmark");
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

        if (!summary) {
          throw new Error("摘要不能为空");
        }

        record.summary = summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;

        if (record.collapsed) {
          dispatchUpdate(message, makeFoldPatch(record), "summary");
        }
      },
    });
  };

  const collectMessages = (value, out = [], seen = new Set(), depth = 0) => {
    if (!value || depth > 7 || out.length > 150 || typeof value !== "object") {
      return out;
    }

    if (seen.has(value)) return out;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        collectMessages(item, out, seen, depth + 1);
      }
      return out;
    }

    if (value.id && (value.channel_id || value.channelId)) {
      out.push(value);
    }

    for (const key of Object.keys(value).slice(0, 35)) {
      if (key === "_owner" || key === "_store") continue;
      collectMessages(value[key], out, seen, depth + 1);
    }

    return out;
  };

  const replayFromAction = action => {
    if (!action || action.__sceneFold) return;

    for (const message of collectMessages(action)) {
      const record = getRecord(message);

      if (record?.collapsed) {
        dispatchUpdate(
          message,
          makeFoldPatch(record),
          `replay:${action.type || "unknown"}`
        );
      }
    }
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
        dispatchUpdate(message, makeFoldPatch(record), "startup");
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
      if (sheetKey !== "MessageLongPressActionSheet") return;

      const message = props?.message;
      if (!message || !component?.then || !ActionSheetRow) return;

      component
        .then(instance => {
          const unpatch = after("default", instance, (_, tree) => {
            React.useEffect(
              () => () => {
                try {
                  unpatch();
                } catch (_) {}
              },
              []
            );

            const buttons = findInReactTree(
              tree,
              value =>
                Array.isArray(value) &&
                value.some(
                  child =>
                    child?.type?.name === "ActionSheetRow" ||
                    typeof child?.props?.label === "string"
                )
            );

            if (!buttons) return;

            if (
              buttons.some(child =>
                String(child?.key || "").startsWith("scenefold-")
              )
            ) {
              return;
            }

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
                  () => (record.collapsed ? expand(message) : refold(message))
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
          logger.error("SceneFold action-sheet patch failed", error);
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
      patches.push(
        after("dispatch", FluxDispatcher, ([action]) => replayFromAction(action))
      );

      replayLoaded();
      logger.log("SceneFold loaded");
    },

    onUnload() {
      for (const unpatch of patches.splice(0)) {
        try {
          unpatch();
        } catch (_) {}
      }

      logger.log("SceneFold unloaded");
    },
  };
})()
