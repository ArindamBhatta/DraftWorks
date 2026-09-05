// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { defineConfig } from "@rstest/core";
import packages from "./package.json" with { type: "json" };

// The same compile-time constants rspack.config.ts injects via DefinePlugin. Without
// them, importing anything that reaches foundation/logger.ts throws at module load.
export default defineConfig({
    testEnvironment: "happy-dom",
    // Scoped to our own sources. The default glob walks the whole repository, which
    // sweeps up the test suites of the dependencies checked out under cpp/build - emsdk
    // and libredwg both ship their own - and reports their failures as ours.
    include: ["{packages,plugins}/**/*.test.ts"],
    source: {
        define: {
            __APP_VERSION__: JSON.stringify(packages.version),
            __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
            __IS_PRODUCTION__: JSON.stringify(false),
        },
    },
});
