// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { defineConfig } from "@rstest/core";
import packages from "./package.json" with { type: "json" };

// The same compile-time constants rspack.config.ts injects via DefinePlugin. Without
// them, importing anything that reaches foundation/logger.ts throws at module load.
export default defineConfig({
    testEnvironment: "happy-dom",
    source: {
        define: {
            __APP_VERSION__: JSON.stringify(packages.version),
            __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
            __IS_PRODUCTION__: JSON.stringify(false),
        },
    },
});
