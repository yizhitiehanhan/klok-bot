import { ethers } from "ethers";
import fs from "fs";
import crypto from "crypto";
import chalk from "chalk";
import fetch from "node-fetch";
import prompt from "prompt-sync";
import cfonts from "cfonts";
import { v4 as uuidv4 } from "uuid";
import { HttpsProxyAgent } from 'https-proxy-agent';

const BASE_URL = "https://api1-pp.klokapp.ai";
const messagesFile = "question.txt";
const privateKeysFile = "privatekeys.txt";
const proxyFile = "proxies.txt";
const promptSync = prompt();
const REFERRAL_CODE = "ZYEG2HRF";

// 添加代理管理
let proxies = [];
if (fs.existsSync(proxyFile)) {
  proxies = fs.readFileSync(proxyFile, "utf-8")
              .split("\n")
              .map(line => line.trim())
              .filter(line => line !== "");
}

// 修改代理获取函数
function getProxy(accountIndex) {
  if (proxies.length === 0) return null;
  // 使用私钥索引获取对应的代理
  return proxies[accountIndex - 1] || proxies[proxies.length - 1];
}

function prettyPrint(obj, indent = 0) {
  const spacing = "  ".repeat(indent);
  for (const key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      console.log(`${spacing}\x1b[36m${key}:\x1b[0m`);
      prettyPrint(obj[key], indent + 1);
    } else {
      console.log(`${spacing}\x1b[36m${key}:\x1b[0m ${obj[key]}`);
    }
  }
}


function taskDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(chalk.bold.grey(`\n⏳ Waiting ${delay / 1000} seconds before the next chat...\n`));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function printSection(title, content, icon = "✨") {
  console.log(`\n\x1b[35m${icon} =========================================== ${title} ========================================== ${icon}\x1b[0m`);
  if (typeof content === "object") {
    prettyPrint(content);
  } else {
    console.log(`\x1b[32m${content}\x1b[0m`);
  }
}

function formatResetTime(resetTime) {
  const resetDate = new Date(Date.now() + resetTime * 1000);
  return resetDate.toLocaleString();
}

async function typeOutText(text, delay = 1) {
  for (const char of text) {
    process.stdout.write(char);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}


// 修改 fetchWithoutRetry 函数以支持代理
async function fetchWithoutRetry(url, options) {
  try {
    let controller, timeout;
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;

    // 添加代理支持
    const proxy = getProxy();
    if (proxy) {
      options.agent = new HttpsProxyAgent(proxy);
    }
    
    const response = await fetch(url, options);
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Request failed`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    console.log(chalk.red(`Error: ${error.message}`));
    return null;
  }
}


if (!fs.existsSync(messagesFile)) {
  console.error(`❌ Error: File "${messagesFile}" not found!`);
  process.exit(1);
}

let messages = fs.readFileSync(messagesFile, "utf-8")
                .split("\n")
                .filter((line) => line.trim() !== "");

if (!fs.existsSync(privateKeysFile)) {
  console.error(`❌ Error: File "${privateKeysFile}" not found!`);
  process.exit(1);
}

const PRIVATE_KEYS = fs.readFileSync(privateKeysFile, "utf-8")
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line !== "");

if (PRIVATE_KEYS.length === 0) {
  console.error("❌ Error: No private keys found!");
  process.exit(1);
}


const threadCount = parseInt(promptSync("🧵 How many threads do you want to run? "), 4);

// 修改线程管理类
class ThreadManager {
  constructor(maxThreads) {
    this.activeThreads = 0;
    this.completedThreads = 0;
    this.totalThreads = 0;
    this.accountStatus = new Map();
    this.maxThreads = maxThreads;
    this.waitingQueue = [];
    this.activeAccounts = new Set(); // 添加当前活动账号集合
  }

  async acquire() {
    if (this.activeThreads >= this.maxThreads) {
      await new Promise(resolve => this.waitingQueue.push(resolve));
    }
    this.activeThreads++;
    this.totalThreads++;
  }

  release() {
    this.activeThreads--;
    this.completedThreads++;
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      next();
    }
  }

  updateAccountStatus(accountIndex, status, currentRun = 0) {
    this.accountStatus.set(accountIndex, {
      status,
      currentRun,
      totalRuns: currentRun,
      timestamp: new Date().toLocaleTimeString()
    });

    if (status === 'Running') {
      this.activeAccounts.add(accountIndex);
    } else if (status === 'Completed' || status === 'Failed' || status === 'Daily Limit Reached') {
      this.activeAccounts.delete(accountIndex);
    }
  }

  getProgress() {
    return {
      active: this.activeThreads,
      completed: this.completedThreads,
      total: this.totalThreads,
      maxThreads: this.maxThreads,
      accountStatus: Array.from(this.accountStatus.entries())
        .filter(([index]) => this.activeAccounts.has(index)) // 只显示当前活动的账号
        .map(([index, status]) => ({
          accountIndex: index,
          ...status
        }))
    };
  }
}

// 创建线程管理器实例
const threadManager = new ThreadManager(threadCount);

async function signAndVerify(privateKey) {
  try {
    const wallet = new ethers.Wallet(privateKey);
    const nonce = crypto.randomBytes(32).toString("hex");
    const issuedAt = new Date().toISOString();
    const message = `klokapp.ai wants you to sign in with your Ethereum account:\n${wallet.address}\n\n\nURI: https://klokapp.ai/\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
    const signature = await wallet.signMessage(message);


    const payload = { signedMessage: signature, message, referral_code: REFERRAL_CODE };


    const headers = {
      "Content-Type": "application/json",
      Accept: "*/*",
      Origin: "https://klokapp.ai",
      Referer: "https://klokapp.ai/",
      "User-Agent": "Mozilla/5.0"
    };

    for (let i = 0; i < 3; i++) {
      const result = await fetchWithoutRetry(`${BASE_URL}/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!result) {
        throw new Error("Verification request failed");
      }
      
      if (result.session_token) {
        return { sessionToken: result.session_token, wallet };
      }
      
      console.warn(chalk.yellow(`Attempt ${i + 1} failed. Retrying...`));
      await new Promise((res) => setTimeout(res, 2000));
    }

    throw new Error("Failed to obtain session token");
  } catch (error) {
    console.error(chalk.red("Error in signAndVerify:"), error);
    return null;
  }
}

async function makeRequests(sessionToken, runNumber) {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    origin: "https://klokapp.ai",
    referer: "https://klokapp.ai/",
    "user-agent": "Mozilla/5.0",
    "x-session-token": sessionToken
  };

  console.log(chalk.cyan(`\n[Run ${runNumber}] Checking rate limit...`));
  const rateCheck = await fetchWithoutRetry(`${BASE_URL}/v1/rate-limit`, {
    method: "GET",
    headers
  });

  if (!rateCheck) {
    console.log(chalk.red("Network error detected!"));
    return { counted: false, dailyLimitReached: false, failed: true };
  }

  if (rateCheck.remaining <= 0) {
    console.log(chalk.bold.redBright(`🚫 Daily limit reached for this account.`));
    console.log(chalk.cyan(`[Run ${runNumber}] Fetching account statistics...`));
    const stats = await fetchWithoutRetry(`${BASE_URL}/v1/chat/stats`, {
      method: "GET",
      headers
    });

    if (stats) {
      console.log(chalk.cyan(`\n📊 Account Statistics:`));
      console.log(chalk.cyan(`   Total Messages: ${stats.total_messages}`));
      console.log(chalk.cyan(`   Points Earned: ${stats.points_earned}`));
      console.log(chalk.cyan(`   Daily Limit: ${stats.daily_limit}`));
      console.log(chalk.cyan(`   Reset Time: ${formatResetTime(stats.reset_time)}`));
    }
    return { counted: false, dailyLimitReached: true, failed: false };
  }

  console.log(chalk.cyan(`[Run ${runNumber}] Sending chat message...`));
  const message = messages[Math.floor(Math.random() * messages.length)];
  const chatResponse = await fetchWithoutRetry(`${BASE_URL}/v1/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: uuidv4(),
      messages: [{ role: "user", content: message }],
      model: "llama-3.3-70b-instruct",
      created_at: new Date().toISOString(),
      language: "english"
    })
  });

  if (!chatResponse) {
    console.log(chalk.red("Failed to send message"));
    return { counted: false, dailyLimitReached: false, failed: true };
  }

  console.log(chalk.green(`✅ Message sent successfully! (Run ${runNumber})`));
  
  // 处理聊天响应
  let responseText = '';
  if (typeof chatResponse === 'object') {
    if (chatResponse.response) {
      responseText = chatResponse.response;
    } else if (chatResponse.choices && chatResponse.choices[0] && chatResponse.choices[0].message) {
      responseText = chatResponse.choices[0].message.content;
    } else {
      responseText = JSON.stringify(chatResponse, null, 2);
    }
  } else if (typeof chatResponse === 'string') {
    responseText = chatResponse;
  } else {
    responseText = JSON.stringify(chatResponse, null, 2);
  }

  console.log('\n'); // 添加一个空行来分隔响应
  console.log(chalk.cyan('Chat Response:'));
  console.log(chalk.white(responseText));
  console.log('\n'); // 添加一个空行来分隔下一个操作

  return { counted: true, dailyLimitReached: false, failed: false };
}

// 添加获取每日限制的函数
async function getDailyLimit(sessionToken) {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    origin: "https://klokapp.ai",
    referer: "https://klokapp.ai/",
    "user-agent": "Mozilla/5.0",
    "x-session-token": sessionToken
  };

  const stats = await fetchWithoutRetry(`${BASE_URL}/v1/chat/stats`, {
    method: "GET",
    headers
  });

  if (stats && stats.daily_limit) {
    return stats.daily_limit;
  }
  return 50; // 默认值
}

// 修改账户处理函数
async function processAccount(privateKey, accountIndex) {
  await threadManager.acquire();
  
  try {
    // 获取钱包地址
    const wallet = new ethers.Wallet(privateKey);
    const proxy = getProxy(accountIndex);
    
    console.log(chalk.cyan(`\nProcessing Account ${accountIndex}/${PRIVATE_KEYS.length}`));
    console.log(chalk.cyan(`Wallet Address: ${wallet.address}`));
    if (proxy) {
      console.log(chalk.cyan(`Using Proxy: ${proxy}`));
    }
    
    // 验证签名
    const authResult = await signAndVerify(privateKey);
    if (!authResult) {
      console.log(chalk.red(`❌ Failed to authenticate account ${accountIndex}`));
      threadManager.updateAccountStatus(accountIndex, 'Failed');
      return;
    }

    const { sessionToken } = authResult;
    console.log(chalk.green(`✅ Account ${accountIndex} authenticated successfully`));
    
    // 获取该账号的每日限制
    const accountDailyLimit = await getDailyLimit(sessionToken);
    console.log(chalk.cyan(`📊 Account ${accountIndex} daily limit: ${accountDailyLimit}`));
    
    threadManager.updateAccountStatus(accountIndex, 'Running');

    // 执行聊天循环
    for (let i = 0; i < accountDailyLimit; i++) {
      threadManager.updateAccountStatus(accountIndex, 'Running', i + 1);
      
      const progress = threadManager.getProgress();
      console.log(chalk.cyan('\n=== Current Processing Status ==='));
      console.log(chalk.cyan(`Active Threads: ${progress.active}/${progress.maxThreads}`));
      console.log(chalk.cyan(`Completed: ${progress.completed}/${progress.total}`));
      console.log(chalk.cyan('\n=== Active Accounts ==='));
      progress.accountStatus.forEach(acc => {
        const statusColor = acc.status === 'Completed' ? 'green' : 
                          acc.status === 'Failed' ? 'red' : 
                          acc.status === 'Running' ? 'yellow' : 'white';
        console.log(chalk[statusColor](
          `Account ${acc.accountIndex}: ${acc.status} ` +
          `(${acc.currentRun}/${acc.totalRuns}) ` +
          `[${acc.timestamp}]`
        ));
      });
      
      const result = await makeRequests(sessionToken, i + 1);
      if (!result) {
        console.log(chalk.red(`❌ Failed to process request ${i + 1} for account ${accountIndex}`));
        continue;
      }

      if (result.failed) {
        console.log(chalk.red(`❌ Failed to process request ${i + 1} for account ${accountIndex}`));
        continue;
      }
      
      if (result.dailyLimitReached) {
        console.log(chalk.yellow(`⚠️ Daily limit reached for account ${accountIndex}`));
        threadManager.updateAccountStatus(accountIndex, 'Daily Limit Reached', i + 1);
        break;
      }
      
      await taskDelay(2000, 5000);
    }

    threadManager.updateAccountStatus(accountIndex, 'Completed', accountDailyLimit);
  } catch (error) {
    console.error(chalk.red(`❌ Error processing account ${accountIndex}:`), error);
    threadManager.updateAccountStatus(accountIndex, 'Failed');
  } finally {
    threadManager.release();
  }
}

// 修改主循环函数
async function main() {
  console.log(chalk.cyan("\n🚀 Starting multi-threaded chat process..."));
  console.log(chalk.cyan(`Maximum concurrent threads: ${threadCount}`));
  
  // 显示代理信息
  if (proxies.length > 0) {
    console.log(chalk.cyan(`Loaded ${proxies.length} proxies`));
  } else {
    console.log(chalk.yellow("No proxies loaded, running without proxy"));
  }
  
  // 为每个私钥创建一个线程
  const promises = PRIVATE_KEYS.map((privateKey, index) => 
    processAccount(privateKey, index + 1)
  );
  
  // 等待所有线程完成
  await Promise.all(promises);
  
  // 显示最终状态
  const finalProgress = threadManager.getProgress();
  console.log(chalk.cyan('\n=== Final Status ==='));
  finalProgress.accountStatus.forEach(acc => {
    const statusColor = acc.status === 'Completed' ? 'green' : 
                      acc.status === 'Failed' ? 'red' : 
                      acc.status === 'Running' ? 'yellow' : 'white';
    console.log(chalk[statusColor](
      `Account ${acc.accountIndex}: ${acc.status} ` +
      `(${acc.currentRun}/${acc.totalRuns})`
    ));
  });
  
  console.log(chalk.green("\n✨ All tasks completed successfully!"));
}

// 启动主程序
main().catch(error => {
  console.error(chalk.red("❌ Fatal error:"), error);
  process.exit(1);
});