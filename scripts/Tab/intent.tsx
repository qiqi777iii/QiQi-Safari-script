import {
  Script,
  Intent,
  Navigation,
  NavigationStack,
  List,
  Section,
  Button,
  Text,
  VStack,
  HStack,
  Image,
  Spacer,
  useState,
  useEffect,
  fetch,
} from "scripting"
import {
  loadStore,
  saveStore,
  createGroup,
  addBookmark,
  sortedGroups,
  ensureDefaultGroup,
  type Group,
  type Store,
} from "./store"

type Incoming = { title: string; url: string }

// Extract the shared url + title from the intent input.
function getIncoming(): Incoming | null {
  const urls = Intent.urlsParameter
  if (urls && urls.length > 0) {
    const texts = Intent.textsParameter
    const title = texts && texts.length > 0 ? texts[0] : urls[0]
    return { title, url: urls[0] }
  }
  // Fallback: a text that looks like a url
  const texts = Intent.textsParameter
  if (texts && texts.length > 0) {
    const found = texts.find(t => /^https?:\/\//i.test(t.trim()))
    if (found) return { title: found, url: found.trim() }
  }
  const sp = Intent.shortcutParameter
  if (sp && sp.type === "text" && typeof sp.value === "string") {
    const v = sp.value.trim()
    if (/^https?:\/\//i.test(v)) return { title: v, url: v }
  }
  // Fallback: a JSON shortcut parameter carrying urls/texts (and mock harness).
  const raw: any = sp && sp.type === "json" ? sp.value : sp
  if (raw && typeof raw === "object") {
    const u = Array.isArray(raw.urls) ? raw.urls[0] : undefined
    if (typeof u === "string" && u) {
      const t = Array.isArray(raw.texts) && raw.texts[0] ? raw.texts[0] : u
      return { title: t, url: u }
    }
    const t2 = Array.isArray(raw.texts)
      ? raw.texts.find((x: string) => /^https?:\/\//i.test(String(x).trim()))
      : undefined
    if (typeof t2 === "string") return { title: t2, url: t2.trim() }
  }
  return null
}

function host(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/?#]+)/i)
  return m ? m[1] : url
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
}

async function fetchTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    const m =
      html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (m && m[1]) {
      const t = decodeEntities(m[1].trim().replace(/\s+/g, " "))
      if (t) return t
    }
    return null
  } catch {
    return null
  }
}

function SaveView({ incoming }: { incoming: Incoming }) {
  const dismiss = Navigation.useDismiss()
  const [store, setStore] = useState<Store>({ version: 1, groups: [] })
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState(incoming.title)
  const [fetchingTitle, setFetchingTitle] = useState(false)

  const titleIsUrl = title.trim() === incoming.url.trim()

  useEffect(() => {
    ;(async () => {
      const s = await loadStore()
      ensureDefaultGroup(s)
      setStore({ ...s })
      setLoading(false)
    })()
    // If the share sheet didn't provide a real title, try to fetch it.
    if (incoming.title.trim() === incoming.url.trim()) {
      setFetchingTitle(true)
      ;(async () => {
        const t = await fetchTitle(incoming.url)
        if (t) setTitle(t)
        setFetchingTitle(false)
      })()
    }
  }, [])

  async function saveTo(group: Group) {
    addBookmark(group, title, incoming.url)
    await saveStore(store)
    dismiss()
  }

  async function editTitle() {
    const t = await Dialog.prompt({
      title: "编辑标题",
      defaultValue: title,
      selectAll: true,
    })
    if (t != null && t.trim()) setTitle(t.trim())
  }

  async function newGroupAndSave() {
    const name = await Dialog.prompt({
      title: "新建分组",
      placeholder: "分组名称",
      confirmLabel: "创建并收藏",
    })
    if (name == null) return
    const g = createGroup(store, name)
    await saveTo(g)
  }

  const groups = sortedGroups(store)

  return (
    <NavigationStack>
      <List
        navigationTitle="收藏到分组"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={dismiss} />,
        }}
      >
        <Section header={<Text>页面</Text>}>
          <Button action={editTitle}>
            <VStack alignment="leading" spacing={2}>
              <HStack>
                <Text
                  font="headline"
                  lineLimit={2}
                  foregroundStyle={titleIsUrl ? "secondaryLabel" : "label"}
                >
                  {fetchingTitle ? "正在获取标题…" : title}
                </Text>
                <Spacer />
                <Image systemName="pencil" foregroundStyle="systemBlue" font="footnote" />
              </HStack>
              <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
                {host(incoming.url)}
              </Text>
            </VStack>
          </Button>
        </Section>

        <Section
          header={<Text>选择分组</Text>}
          footer={
            <Text>点击分组即可收藏，或新建一个分组。</Text>
          }
        >
          <Button title="＋ 新建分组并收藏" action={newGroupAndSave} />
          {loading ? (
            <Text foregroundStyle="secondaryLabel">加载中…</Text>
          ) : (
            groups.map((g: Group) => (
              <Button key={g.id} action={() => saveTo(g)}>
                <HStack>
                  <Image
                    systemName="folder"
                    foregroundStyle="systemBlue"
                  />
                  <Text>{g.name}</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">
                    {g.bookmarks.length}
                  </Text>
                </HStack>
              </Button>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  const incoming = getIncoming()
  if (!incoming) {
    await Dialog.alert({
      title: "没有可收藏的链接",
      message: "请从浏览器或其它 App 的分享菜单分享网页链接。",
    })
    Script.exit(Intent.text("no url"))
    return
  }
  await Navigation.present(<SaveView incoming={incoming} />)
  Script.exit(Intent.text("done"))
}

run()
