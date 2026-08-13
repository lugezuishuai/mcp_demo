import { constants, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(process.cwd(), ".env.example");
const targetPath = resolve(process.cwd(), ".env");

try {
  // COPYFILE_EXCL 保证初始化命令不会覆盖开发者已填写的真实密钥。
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  console.log("Created .env from .env.example");
} catch (error) {
  if (isFileExistsError(error)) {
    console.log("Kept existing .env (no changes made)");
  } else {
    throw error;
  }
}

/**
 * 识别目标文件已存在错误，其他文件系统异常继续向上抛出。
 */
function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
