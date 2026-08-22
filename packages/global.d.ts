// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

declare module "*.module.css" {
    const classes: any;
    export default classes;
}

declare module "*.wasm" {
    const fun: string;
    export default fun;
}

declare module "*.cur" {
    const cur: string;
    export default cur;
}

declare module "*.svg" {
    const icon: string;
    export default icon;
}

declare module "*.jpg" {
    const path: string;
    export default path;
}

declare module "*.sass";

// @rstest/core's JestAssertion interface extends jest.Matchers (normally provided
// by @types/jest); shim the namespace so tsc --noEmit stays clean without the extra dep
declare namespace jest {
    // biome-ignore lint/suspicious/noEmptyInterface: intentional shim for @rstest/core types
    interface Matchers<R, T> {}
}

declare var __APP_VERSION__: string;
declare var __DOCUMENT_VERSION__: string;
declare var __IS_PRODUCTION__: boolean;
