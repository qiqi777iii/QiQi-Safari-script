import {
  Button,
  HStack,
  Image,
  Link,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import {
  clearVideoHistory,
  deleteVideoHistory,
  loadVideoHistory,
  type VideoHistoryRecord,
  type VideoHistoryStore,
} from "./store"

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function formatDate(timestamp: number): string {
  return Number.isFinite(timestamp) && timestamp > 0
    ? dateFormatter.format(new Date(timestamp))
    : "未知时间"
}

function displayCode(code: string): string {
  return code.toUpperCase()
}

export default function HistoryView() {
  const dismiss = Navigation.useDismiss()
  const [store, setStore] = useState<VideoHistoryStore>({ version: 1, updatedAt: 0, records: {} })
  const [loading, setLoading] = useState(true)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)

  const reload = async () => {
    setLoading(true)
    setStore(await loadVideoHistory())
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [])

  const records = Object.values(store.records)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)

  const removeRecord = async (record: VideoHistoryRecord) => {
    setStore(await deleteVideoHistory(record.code))
  }

  const removeAll = async () => {
    setShowClearConfirmation(false)
    if (!Object.keys(store.records).length) return
    setStore(await clearVideoHistory())
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="视频打开记录"
        navigationBarTitleDisplayMode="inline"
        alert={{
          title: "清空打开记录",
          message: <Text>将永久删除全部视频打开记录。</Text>,
          isPresented: showClearConfirmation,
          onChanged: setShowClearConfirmation,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowClearConfirmation(false)} />
              <Button title="清空" role="destructive" action={() => { void removeAll() }} />
            </>
          ),
        }}
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          primaryAction: <Button title="刷新" systemImage="arrow.clockwise" action={() => { void reload() }} />,
        }}
      >
        <Section
          header={<Text>历史记录</Text>}
          footer={<Text>由 Safari“标签页检查”自动记录，最多保留最近 5000 个视频。</Text>}
        >
          <HStack>
            <Text>记录数量</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{Object.keys(store.records).length}</Text>
          </HStack>
        </Section>

        {loading ? (
          <Section>
            <HStack>
              <Spacer />
              <ProgressView />
              <Spacer />
            </HStack>
          </Section>
        ) : records.length ? (
          <Section title="最近打开">
            {records.map(record => (
              <Link
                key={record.code}
                url={record.url}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="删除"
                      systemImage="trash"
                      role="destructive"
                      action={() => { void removeRecord(record) }}
                    />,
                  ],
                }}
              >
                <HStack frame={{ minHeight: 50 }}>
                  <Image
                    systemName="play.rectangle.fill"
                    foregroundStyle="systemGreen"
                    font="title3"
                  />
                  <VStack alignment="leading" spacing={4}>
                    <Text font="headline">{displayCode(record.code)}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {`最近打开：${formatDate(record.lastOpenedAt)}`}
                    </Text>
                    <Text font="caption2" foregroundStyle="tertiaryLabel">
                      {record.openCount > 1
                        ? `首次：${formatDate(record.firstOpenedAt)} · ${record.openCount} 次`
                        : `首次：${formatDate(record.firstOpenedAt)}`}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image systemName="arrow.up.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Link>
            ))}
          </Section>
        ) : (
          <Section>
            <VStack alignment="center" spacing={8} frame={{ maxWidth: Infinity, minHeight: 120 }}>
              <Image systemName="clock.badge.questionmark" font="title" foregroundStyle="secondaryLabel" />
              <Text foregroundStyle="secondaryLabel">还没有打开记录</Text>
            </VStack>
          </Section>
        )}

        <Section footer={<Text>向左滑动一条记录可以删除；点击记录会在 Safari 中打开视频。</Text>}>
          <Button
            title="清空全部记录"
            systemImage="trash"
            role="destructive"
            action={() => setShowClearConfirmation(true)}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<HistoryView />)
  Script.exit()
}

run()
