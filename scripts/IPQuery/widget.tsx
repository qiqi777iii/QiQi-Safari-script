import { Button, HStack, Image, Text, VStack, Widget, type ShapeStyle } from "scripting"
import { RefreshIPIntent } from "./app_intents"
import { countryFlag, IPInfo, readCachedIPInfo, scoreColor } from "./data"

function CompactRow({ label, value, color = "label" }: { label: string, value: string, color?: ShapeStyle }) {
  return <HStack spacing={5}>
    <Text font="caption2" foregroundStyle="secondaryLabel">{label}</Text>
    <Text font="caption2" fontWeight="semibold" foregroundStyle={color} lineLimit={1} minScaleFactor={0.65}>{value}</Text>
  </HStack>
}

function WidgetView({ info }: { info: IPInfo }) {
  const compact = Widget.family === "systemSmall"
  const score = info.score === null ? "—" : `${info.score}/100`
  const flag = countryFlag(info)

  if (compact) {
    return <Button intent={RefreshIPIntent(undefined)} buttonStyle="plain">
      <VStack padding={12} alignment="center" spacing={4}>
        <Text font="caption2" foregroundStyle="secondaryLabel">IP 地址</Text>
        <Text font={20} fontWeight="bold" fontDesign="rounded" lineLimit={1} minScaleFactor={0.62}>{info.ip}</Text>
        <HStack spacing={5}>
          <Text font="caption2" foregroundStyle="secondaryLabel">国家</Text>
          <Text font={15}>{flag}</Text>
          <Text font="subheadline" fontWeight="semibold">{info.country}</Text>
        </HStack>
        <CompactRow label="ISP" value={info.isp} />
        <CompactRow label="场景" value={info.category} />
        <CompactRow label="类型" value={info.nativeIP} color="systemBlue" />
        <CompactRow label="评分" value={score} color={scoreColor(info.score)} />
      </VStack>
    </Button>
  }

  return <Button intent={RefreshIPIntent(undefined)} buttonStyle="plain">
    <VStack padding={16} alignment="center" spacing={8}>
      <Text font="caption2" foregroundStyle="secondaryLabel">IP 地址</Text>
      <Text font={25} fontWeight="bold" fontDesign="rounded" lineLimit={1} minScaleFactor={0.62}>{info.ip}</Text>
      <HStack spacing={6}>
        <Text font="caption2" foregroundStyle="secondaryLabel">国家</Text>
        <Text font={19}>{flag}</Text>
        <Text font="title3" fontWeight="semibold" lineLimit={1}>{info.country}</Text>
      </HStack>
      <HStack spacing={5}>
        <Text font="caption2" foregroundStyle="secondaryLabel">ISP</Text>
        <Text font="caption" fontWeight="semibold">{info.isp}</Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel">·</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">场景</Text>
        <Text font="caption" fontWeight="semibold" lineLimit={1}>{info.category}</Text>
      </HStack>
      <HStack spacing={5}>
        <Text font="caption2" foregroundStyle="secondaryLabel">类型</Text>
        <Text font="caption" fontWeight="semibold" foregroundStyle="systemBlue" lineLimit={1}>{info.nativeIP}</Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel">·</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">评分</Text>
        <Text font="caption" fontWeight="bold" foregroundStyle={scoreColor(info.score)}>{score}</Text>
      </HStack>
    </VStack>
  </Button>
}

function EmptyWidget() {
  return <Button intent={RefreshIPIntent(undefined)} buttonStyle="plain">
    <VStack padding={16} alignment="center" spacing={8}>
      <Image systemName="network" foregroundStyle="systemBlue" font={24} />
      <Text font="headline" fontWeight="bold">点按查询当前 IP</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">点击小组件刷新</Text>
    </VStack>
  </Button>
}

function runWidget() {
  const cached = readCachedIPInfo()
  Widget.present(cached ? <WidgetView info={cached} /> : <EmptyWidget />, { policy: "never" })
}

runWidget()
