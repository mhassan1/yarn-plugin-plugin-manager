import { Configuration, structUtils } from "@yarnpkg/core";
import { xfs, npath, ppath, PortablePath } from "@yarnpkg/fslib";
import { spawn } from "child_process";
import md5File from "md5-file";

const gitignore = `node_modules
**/.yarn/*
!**/.yarn/releases
!**/.yarn/plugins
!**/.yarn/sdks
!**/.yarn/versions
`;

const yarnRc = `lockfileFilename: yarn.lock
nodeLinker: node-modules
`;

const packageJson = `{
}
`;

const yarnLock = `
`;

/**
 *
 * @param projectCwd
 */
export const createSkeleton = async (
  projectCwd: PortablePath
): Promise<void> => {
  const pluginManagerCwd = ppath.join(
    projectCwd,
    ".yarn/plugins/plugin-manager" as PortablePath
  );

  await xfs.mkdirpPromise(pluginManagerCwd);

  await xfs.writeFilePromise(
    ppath.join(pluginManagerCwd, ".gitignore" as PortablePath),
    gitignore
  );
  await xfs.writeFilePromise(
    ppath.join(pluginManagerCwd, ".yarnrc.yml" as PortablePath),
    yarnRc
  );

  const packageJsonPath = ppath.join(
    pluginManagerCwd,
    "package.json" as PortablePath
  );
  if (!(await xfs.existsPromise(packageJsonPath))) {
    await xfs.writeFilePromise(packageJsonPath, packageJson);
  }

  const yarnLockPath = ppath.join(
    pluginManagerCwd,
    "yarn.lock" as PortablePath
  );
  if (!(await xfs.existsPromise(yarnLockPath))) {
    await xfs.writeFilePromise(yarnLockPath, yarnLock);
  }
};

export type ExitCode = 0 | 1;

/**
 *
 * @param yarnSpawnArgs
 */
export const yarnSpawn = async (
  yarnSpawnArgs: YarnSpawnArgs | YarnSpawnArgs[]
): Promise<ExitCode> => {
  if (!Array.isArray(yarnSpawnArgs)) {
    return _yarnSpawn(yarnSpawnArgs);
  }

  for (const _yarnSpawnArgs of yarnSpawnArgs) {
    const exitCode = await _yarnSpawn(_yarnSpawnArgs);
    if (exitCode) {
      return exitCode;
    }
  }
  return 0;
};

/**
 *
 * @param yarnSpawnArgs
 */
export const _yarnSpawn = async (
  yarnSpawnArgs: YarnSpawnArgs
): Promise<ExitCode> => {
  const { cwd, args, env = process.env } = yarnSpawnArgs;
  return new Promise((resolve) => {
    spawn("yarn", args, {
      stdio: "inherit",
      cwd: npath.fromPortablePath(cwd),
      env,
    }).on("exit", (code) => resolve(code ? 1 : 0));
  });
};

/**
 *
 * @param projectCwd
 * @param commandArgs
 */
export const executeProxyCommand = async (
  projectCwd: PortablePath,
  commandArgs: string[]
): Promise<ExitCode> => {
  const pluginManagerCwd = ppath.join(
    projectCwd,
    ".yarn/plugins/plugin-manager" as PortablePath
  );
  return yarnSpawn({
    cwd: pluginManagerCwd,
    args: commandArgs,
    env: omitCaseInsensitive(process.env, [
      "YARN_RC_FILENAME",
      "YARN_LOCKFILE_FILENAME",
      "YARN_NODE_LINKER",
    ]),
  });
};

/**
 *
 * @param obj
 * @param keys
 */
export const omitCaseInsensitive = (
  obj: { [key: string]: any },
  keys: string[]
): { [key: string]: any } => {
  const lowerKeys = keys.map((key) => key.toLowerCase());
  const result: { [key: string]: any } = {};
  for (const [key, value] of Object.entries(obj)) {
    if (lowerKeys.includes(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
};

type ManifestDependencies = {
  [key: string]: string;
};

/**
 *
 * @param projectCwd
 */
export const getManifestDependencies = async (
  projectCwd: PortablePath
): Promise<ManifestDependencies> => {
  const pluginManagerManifest = JSON.parse(
    await xfs.readFilePromise(
      ppath.join(projectCwd, "package.json" as PortablePath),
      "utf8"
    )
  );
  return pluginManagerManifest.dependencies || {};
};

type InstalledPlugin = {
  path: string;
  spec: string;
};

/**
 *
 * @param projectCwd
 */
export const getInstalledPlugins = async (
  projectCwd: PortablePath
): Promise<InstalledPlugin[]> => {
  const currentPlugins: InstalledPlugin[] = [];
  await Configuration.updateConfiguration(
    projectCwd,
    (current: { [key: string]: unknown }) => {
      if (Array.isArray(current.plugins)) {
        for (const plugin of current.plugins) {
          currentPlugins.push({
            path: plugin?.path || plugin,
            spec: plugin?.spec || plugin,
          });
        }
      }
      return current;
    }
  );
  return currentPlugins;
};

type YarnSpawnArgs = {
  cwd: PortablePath;
  args: string[];
  env?: { [key: string]: string };
};

/**
 *
 * @param projectCwd
 * @param pluginManagerDependencies
 */
export const removePlugins = async (
  projectCwd: PortablePath,
  pluginManagerDependencies: ManifestDependencies
): Promise<YarnSpawnArgs[]> => {
  const yarnSpawnArgs: YarnSpawnArgs[] = [];

  const specRegex = /^\.yarn\/plugins\/plugin-manager\/node_modules\/(.+)\/bundles\/(.+)\.c?js$/;
  const installedPlugins: {
    path: string;
    spec: string;
  }[] = await getInstalledPlugins(projectCwd);

  for (const { spec } of installedPlugins) {
    const match = spec.match(specRegex);
    if (match) {
      const [, pluginIdentStr, pluginName] = match;
      if (!(pluginIdentStr in pluginManagerDependencies)) {
        yarnSpawnArgs.push({
          cwd: projectCwd,
          args: ["plugin", "remove", pluginName],
        });
      }
    }
  }

  return yarnSpawnArgs;
};

/**
 *
 * @param projectCwd
 * @param pluginManagerDependencies
 */
export const addPlugins = async (
  projectCwd: PortablePath,
  pluginManagerDependencies: ManifestDependencies
): Promise<YarnSpawnArgs[]> => {
  const yarnSpawnArgs: YarnSpawnArgs[] = [];

  const pluginManagerCwd = ppath.join(
    projectCwd,
    ".yarn/plugins/plugin-manager" as PortablePath
  );
  for (const pluginIdentStr of Object.keys(pluginManagerDependencies)) {
    const ident = structUtils.parseIdent(pluginIdentStr);
    const { name } = ident;
    if (!name.startsWith("yarn-plugin-")) {
      throw new Error(
        `Package name does not start with "yarn-plugin-": ${structUtils.stringifyIdent(
          ident
        )}`
      );
    }
    const filenameWithoutExtension = name.slice("yarn-".length);
    let portablePath: PortablePath | undefined;
    for (const extension of [".js", ".cjs"]) {
      const _filenameWithExtension = `${filenameWithoutExtension}${extension}`;
      const _portablePath = ppath.join(
        pluginManagerCwd,
        "node_modules" as PortablePath,
        structUtils.stringifyIdent(ident) as PortablePath,
        "bundles/@yarnpkg" as PortablePath,
        _filenameWithExtension as PortablePath
      );
      if (await xfs.existsPromise(_portablePath)) {
        portablePath = _portablePath;
        break;
      }
    }

    if (!portablePath) {
      throw new Error(
        `Bundle not found in package: ${structUtils.stringifyIdent(ident)}`
      );
    }

    const pluginNativePath = npath.fromPortablePath(portablePath);
    const installedPortablePath = ppath.join(
      projectCwd,
      ".yarn/plugins/@yarnpkg" as PortablePath,
      `${filenameWithoutExtension}.cjs` as PortablePath
    );

    if (await xfs.existsPromise(installedPortablePath)) {
      const pluginHash = await md5File(pluginNativePath);
      const installedHash = await md5File(
        npath.fromPortablePath(installedPortablePath)
      );
      if (pluginHash === installedHash) return [];
    }

    yarnSpawnArgs.push({
      cwd: projectCwd,
      args: ["plugin", "import", pluginNativePath],
    });
  }

  return yarnSpawnArgs;
};

/**
 *
 * @param projectCwd
 */
export const syncPlugins = async (
  projectCwd: PortablePath
): Promise<ExitCode> => {
  const pluginManagerCwd = ppath.join(
    projectCwd,
    ".yarn/plugins/plugin-manager" as PortablePath
  );
  const pluginManagerDependencies = await getManifestDependencies(
    pluginManagerCwd
  );

  const exitCode = await yarnSpawn(
    await removePlugins(projectCwd, pluginManagerDependencies)
  );

  if (exitCode) {
    return exitCode;
  }

  return yarnSpawn(await addPlugins(projectCwd, pluginManagerDependencies));
};
