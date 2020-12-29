import { Plugin } from "@yarnpkg/core";
import { ProxyCommand } from "./commands/proxy";

const plugin: Plugin = {
  commands: [ProxyCommand],
};
export default plugin;
