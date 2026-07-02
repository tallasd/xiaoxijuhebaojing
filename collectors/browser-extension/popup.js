const fields = [
  "hubApiUrl",
  "collectorToken",
  "platform",
  "shopName",
  "site",
  "deviceName",
  "location",
  "patrolIntervalSeconds"
];

const presets = [
  {
    label: "Shopee 台湾店1",
    collectorToken: "collector-shopee-tw-01",
    platform: "Shopee TW",
    shopName: "Shopee 台湾店1",
    site: "TW",
    deviceName: "云端浏览器-Shopee台湾店1",
    location: "本地云端浏览器"
  },
  {
    label: "Shopee 台湾店2",
    collectorToken: "collector-shopee-tw-02",
    platform: "Shopee TW",
    shopName: "Shopee 台湾店2",
    site: "TW",
    deviceName: "云端浏览器-Shopee台湾店2",
    location: "本地云端浏览器"
  },
  {
    label: "Shopee 台湾店3",
    collectorToken: "collector-shopee-tw-03",
    platform: "Shopee TW",
    shopName: "Shopee 台湾店3",
    site: "TW",
    deviceName: "云端浏览器-Shopee台湾店3",
    location: "本地云端浏览器"
  },
  {
    label: "Shopee 台湾店4",
    collectorToken: "collector-shopee-tw-04",
    platform: "Shopee TW",
    shopName: "Shopee 台湾店4",
    site: "TW",
    deviceName: "云端浏览器-Shopee台湾店4",
    location: "本地云端浏览器"
  },
  {
    label: "Shopee 马来店1",
    collectorToken: "collector-shopee-my-01",
    platform: "Shopee MY",
    shopName: "Shopee 马来店1",
    site: "MY",
    deviceName: "云端浏览器-Shopee马来店1",
    location: "本地云端浏览器"
  },
  {
    label: "Discord 环境1",
    collectorToken: "collector-discord-01",
    platform: "Discord",
    shopName: "Discord 环境1",
    site: "GLOBAL",
    deviceName: "Discord聊天环境1",
    location: "本地云端浏览器"
  },
  {
    label: "Discord 环境2",
    collectorToken: "collector-discord-02",
    platform: "Discord",
    shopName: "Discord 环境2",
    site: "GLOBAL",
    deviceName: "Discord聊天环境2",
    location: "本地云端浏览器"
  }
];

async function load() {
  const preset = document.getElementById("preset");
  preset.innerHTML = `<option value="">选择店铺/环境</option>${presets
    .map((item, index) => `<option value="${index}">${item.label}</option>`)
    .join("")}`;

  const data = await chrome.storage.sync.get(fields);
  for (const field of fields) {
    document.getElementById(field).value = data[field] ?? "";
  }
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectFormData() {
  const data = Object.fromEntries(fields.map((field) => [field, document.getElementById(field).value.trim()]));
  data.hubApiUrl = data.hubApiUrl || "http://127.0.0.1:4100";
  data.patrolIntervalSeconds = Number(data.patrolIntervalSeconds || 30);
  if (!data.collectorToken) {
    data.collectorToken = `collector-${slug(data.platform)}-${slug(data.shopName || data.deviceName)}-${Date.now()}`;
    document.getElementById("collectorToken").value = data.collectorToken;
  }
  return data;
}

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

document.getElementById("preset").addEventListener("change", (event) => {
  const selected = presets[Number(event.target.value)];
  if (!selected) return;
  for (const field of fields) {
    if (field === "hubApiUrl" || field === "patrolIntervalSeconds") continue;
    document.getElementById(field).value = selected[field] ?? "";
  }
  document.getElementById("hubApiUrl").value ||= "http://127.0.0.1:4100";
  document.getElementById("patrolIntervalSeconds").value ||= 30;
});

document.getElementById("save").addEventListener("click", async () => {
  const data = collectFormData();
  await chrome.storage.sync.set(data);
  setStatus("已保存。");
  window.close();
});

document.getElementById("register").addEventListener("click", async () => {
  const data = collectFormData();
  if (!data.platform || !data.shopName) {
    setStatus("请先填写平台和店铺/环境名称。");
    return;
  }

  setStatus("正在登记到中台...");
  await chrome.storage.sync.set(data);

  try {
    const response = await fetch(`${data.hubApiUrl}/api/collectors/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: data.collectorToken,
        platform: data.platform,
        platformType: data.platform === "Discord" ? "网页聊天插件" : "网页插件",
        site: data.site,
        shopName: data.shopName,
        deviceName: data.deviceName || data.shopName,
        deviceType: "浏览器插件",
        location: data.location || "本地云端浏览器"
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `登记失败：${response.status}`);
    }

    setStatus("登记成功。刷新中台配置页就能看到。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "登记失败，请检查中台是否打开。");
  }
});

load();
