/** noVNC's RFB client. The package ships JavaScript without types this project can see. */
declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { wsProtocols?: string[] })
    scaleViewport: boolean
    focusOnClick: boolean
    disconnect(): void
  }
}
