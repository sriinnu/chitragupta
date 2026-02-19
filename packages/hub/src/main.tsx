/**
 * Entry point for the Chitragupta Hub SPA.
 *
 * Mounts the root {@link App} component into the `#app` DOM element
 * created by `index.html`. This module is loaded by Vite as the
 * application entry and should not contain any logic beyond the
 * initial render call.
 * @module main
 */

import { render } from "preact";
import { App } from "./app.js";

render(<App />, document.getElementById("app")!);
