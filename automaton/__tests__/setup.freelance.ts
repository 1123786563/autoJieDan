import { beforeAll, afterAll } from 'vitest';

export default async function setup() {
  // Freelance 模块测试设置
  beforeAll(async () => {
    // 初始化测试环境
    process.env.FREELANCE_ENABLED = 'true';
    process.env.LOG_LEVEL = 'error';
  });

  afterAll(async () => {
    // 清理测试环境
  });
}
