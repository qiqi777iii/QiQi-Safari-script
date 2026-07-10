import {
  Button,
  ContentUnavailableView,
  Label,
  LabeledContent,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  Text,
  TextField,
  Widget,
  useEffect,
  useState,
} from "scripting"
import { countryFlag, fetchIPInfo, IPInfo, readCachedIPInfo, scoreColor } from "./data"
import { IPLookupResult, lookupIP } from "./lookup"

function InfoSection({ info, title = "查询结果" }: { info: IPInfo, title?: string }) {
  return <Section header={<Label title={title} systemImage="network" />}>
    <LabeledContent title="IP" value={info.ip} />
    <LabeledContent title="ISP" value={info.isp} />
    <LabeledContent title="IP 类型" value={info.nativeIP} />
    <LabeledContent title="国家" value={`${countryFlag(info)} ${info.country}`} />
    <LabeledContent title="使用场景" value={info.category} />
    <LabeledContent title="IP 评分">
      <Text foregroundStyle={scoreColor(info.score)} fontWeight="semibold">
        {info.score === null ? "—" : `${info.score}/100`}
      </Text>
    </LabeledContent>
  </Section>
}

function SearchView() {
  const [input, setInput] = useState("")
  const [result, setResult] = useState<IPLookupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      setResult(await lookupIP(input))
    } catch (reason) {
      setResult(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return <List
    navigationTitle="IP 查询"
    navigationBarTitleDisplayMode="inline"
    overlay={loading ? <ProgressView title="正在查询 IPLark…" /> : undefined}
  >
    <Section footer={<Text>输入 IPv4 地址，查询结果不会改变桌面小组件的当前出口 IP。</Text>}>
      <TextField
        title="IP 地址"
        prompt="例如 8.8.8.8"
        value={input}
        onChanged={setInput}
        keyboardType="numbersAndPunctuation"
        autocorrectionDisabled
        textInputAutocapitalization="never"
      />
      <Button title={loading ? "查询中…" : "查询"} action={search} disabled={loading || !input.trim()} />
    </Section>

    {error ? <Section>
      <Text foregroundStyle="systemRed">{error}</Text>
    </Section> : null}
    {result ? <InfoSection info={result.info} /> : null}
  </List>
}

function MainView() {
  const dismiss = Navigation.useDismiss()
  const [info, setInfo] = useState<IPInfo | null>(() => readCachedIPInfo())
  const [loading, setLoading] = useState(() => !readCachedIPInfo())
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const latest = await fetchIPInfo()
      setInfo(latest)
      Widget.reloadAll()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return <NavigationStack>
    <List
      navigationTitle="当前 IP"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="关闭" action={dismiss} />,
        primaryAction: <Button title={loading ? "更新中…" : "刷新"} action={refresh} disabled={loading} />,
      }}
      overlay={!info && loading
        ? <ProgressView title="正在连接 IPLark…" />
        : !info
          ? <ContentUnavailableView title="无法获取 IP 信息" systemImage="wifi.exclamationmark" description={error ?? "请稍后重试"} />
          : undefined}
    >
      {info ? <InfoSection info={info} title="出口信息" /> : null}
      {info ? <Section footer={<Text>{error ? `刷新失败：${error}（当前显示缓存）` : `数据来自 IPLark · ${new Date(info.updatedAt).toLocaleString()}`}</Text>}>
        <NavigationLink destination={<SearchView />} title="查询指定 IP" />
        <Button title="预览小组件" action={() => Widget.preview({ family: "systemMedium" })} />
      </Section> : null}
    </List>
  </NavigationStack>
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
