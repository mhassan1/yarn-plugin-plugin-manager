import { Command } from "clipanion";
import { Configuration, Project, CommandContext } from "@yarnpkg/core";
import {
  ExitCode,
  createSkeleton,
  executeProxyCommand,
  syncPlugins,
} from "../utils";

/**
 * TODO
 */
export class ProxyCommand extends Command<CommandContext> {
  @Command.Proxy()
  args: Array<string> = [];

  // TODO add usage

  /**
   *
   */
  @Command.Path("plugin-manager")
  async execute(): Promise<ExitCode> {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins
    );
    const { project } = await Project.find(configuration, this.context.cwd);
    const projectCwd = project.cwd;

    await createSkeleton(projectCwd);

    const exitCode: ExitCode = await executeProxyCommand(projectCwd, this.args);

    if (exitCode) {
      return exitCode;
    }

    return syncPlugins(projectCwd);
  }
}
