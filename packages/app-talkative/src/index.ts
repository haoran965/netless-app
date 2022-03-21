import styles from "./style.css?inline";

import type { NetlessApp } from "@netless/window-manager";
import { Logger } from "@netless/app-shared";
import { SideEffectManager } from "side-effect-manager";
import { ResizeObserver as Polyfill } from "@juggle/resize-observer";
import { getUserPayload } from "./utils";

export interface TalkativeAttributes {
  /** (required) courseware url */
  src: string;
  /** teacher's uid */
  uid: string;
  /** current page */
  page: number;
  pageNum: number;
  /** sync to new users */
  lastMsg: string;
}

export interface MagixEventPayloads {
  broadcast: string;
}

export interface TalkativeOptions {
  debug?: boolean;
}

const ResizeObserver = window.ResizeObserver || Polyfill;

const Talkative: NetlessApp<TalkativeAttributes, MagixEventPayloads, TalkativeOptions> = {
  kind: "Talkative",
  setup(context) {
    const debug = (context.getAppOptions() || {}).debug;
    const logger = new Logger("Talkative", debug);
    const { uid, memberId, nickName } = getUserPayload(context);
    const sideEffect = new SideEffectManager();

    context.storage.ensureState({
      src: "https://example.org",
      uid: "",
      page: 1,
      pageNum: 1,
      lastMsg: "",
    });

    if (!context.storage.state.uid) {
      if (!context.isAddApp) {
        logger.log("no teacher's uid, fallback to a random guy");
      }
      context.storage.setState({ uid });
    }

    const role = context.storage.state.uid === uid ? 0 : 2;
    const query = `?userid=${memberId}&role=${role}&name=${nickName}`;

    const box = context.getBox();
    box.mountStyles(styles);

    const $content = document.createElement("div");
    $content.className = "app-talkative-container";
    box.mountContent($content);

    const iframe = document.createElement("iframe");
    $content.appendChild(iframe);

    let ratio = 16 / 9;
    const aspectRatio = (entries: ResizeObserverEntry[]) => {
      const { width, height } = entries[0]?.contentRect || $content.getBoundingClientRect();
      if (width / ratio > height) {
        const targetWidth = height * ratio;
        iframe.style.width = `${targetWidth}px`;
        iframe.style.height = "";
      } else if (width / ratio < height) {
        const targetHeight = width / ratio;
        iframe.style.width = "";
        iframe.style.height = `${targetHeight}px`;
      }
    };

    sideEffect.add(() => {
      const observer = new ResizeObserver(aspectRatio);
      observer.observe($content);
      return observer.disconnect.bind(observer);
    });

    const postMessage = (message: unknown) => {
      iframe.contentWindow?.postMessage(message, "*");
    };

    const handlers = {
      onPagenum({ totalPages }: { totalPages: number }) {
        context.storage.setState({ pageNum: totalPages });
      },

      onLoadComplete(data: { totalPages: number; coursewareRatio: number }) {
        ratio = data.coursewareRatio;
        aspectRatio([]);

        // send last message to sync state
        context.storage.setState({ pageNum: data.totalPages });
        const { page, lastMsg } = context.storage.state;
        lastMsg && postMessage(lastMsg);

        // send first page jump message
        postMessage(JSON.stringify({ method: "onJumpPage", toPage: page }));
      },

      onFileMessage(event: Record<string, unknown>) {
        context.dispatchMagixEvent("broadcast", JSON.stringify(event));

        // save last message
        const lastMsg = JSON.stringify({ ...event, isRestore: true });
        context.storage.setState({ lastMsg });
      },
    };

    sideEffect.addDisposer(
      context.addMagixEventListener("broadcast", ({ payload }) => {
        postMessage(payload);
      })
    );

    sideEffect.addEventListener(window, "message", ev => {
      if (ev.source !== iframe.contentWindow) return;
      if (typeof ev.data === "string") {
        try {
          const event = JSON.parse(ev.data);
          if (typeof event === "object" && event !== null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = (handlers as any)[event.method];
            if (handler) {
              handler(event);
            } else {
              logger.warn("unknown message", event);
            }
          }
        } catch (error) {
          logger.warn("error when parsing message", error);
        }
      } else if (typeof ev.data === "object" && ev.data !== null) {
        logger.log("unhandled permission command", ev.data);
      }
    });

    context.emitter.on("destroy", () => {
      sideEffect.flushAll();
    });

    iframe.src = context.storage.state.src + query;
  },
};

export default Talkative;
