declare module "firebase/app" {
  export type FirebaseApp = {
    name: string;
    options: Record<string, unknown>;
  };
  export function initializeApp(options: Record<string, unknown>, name?: string): FirebaseApp;
}

declare module "firebase/messaging" {
  export type Messaging = object;
  export type MessagePayload = {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  };
  export function getMessaging(app?: unknown): Messaging;
  export function getToken(
    messaging: Messaging,
    options?: { vapidKey?: string; serviceWorkerRegistration?: ServiceWorkerRegistration },
  ): Promise<string>;
  export function onMessage(messaging: Messaging, observer: (payload: MessagePayload) => void): () => void;
  export function isSupported(): Promise<boolean>;
}

declare module "jspdf" {
  export class jsPDF {
    constructor(options?: unknown);
    addPage(...args: unknown[]): this;
    save(...args: unknown[]): unknown;
    addImage(...args: unknown[]): this;
    internal: {
      pageSize: {
        getWidth: () => number;
        getHeight: () => number;
      };
    };
  }
}

declare module "@react-three/drei/core/RoundedBox.js" {
  import type { ComponentType } from "react";
  export const RoundedBox: ComponentType<Record<string, unknown>>;
}

declare module "@react-three/drei/core/MeshReflectorMaterial.js" {
  import type { ComponentType } from "react";
  export const MeshReflectorMaterial: ComponentType<Record<string, unknown>>;
}
