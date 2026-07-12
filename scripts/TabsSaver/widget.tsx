import { HStack, Image, Link, Script, Spacer, Text, VStack, Widget } from "scripting"
import { loadStore, totalBookmarkCount, type Bookmark, type Store } from "./store"

type RecentBookmark = {
  bookmark: Bookmark
  groupName: string
}

function recentBookmarks(store: Store): RecentBookmark[] {
  const recent: RecentBookmark[] = []
  for (const group of store.groups) {
    for (const bookmark of group.bookmarks) {
      const item = { bookmark, groupName: group.name }
      const index = recent.findIndex(existing => bookmark.savedAt > existing.bookmark.savedAt)
      if (index < 0) recent.push(item)
      else recent.splice(index, 0, item)
      if (recent.length > 3) recent.pop()
    }
  }
  return recent
}

function SmallWidget({ store }: { store: Store }) {
  const total = totalBookmarkCount(store)

  return (
    <Link url={Script.createRunSingleURLScheme("Tabs Saver")} buttonStyle="plain">
      <VStack padding={14} alignment="center" spacing={7}>
        <HStack spacing={8}>
          <Image systemName="bookmark.fill" foregroundStyle="systemBlue" font={22} />
          <Text font="headline" fontWeight="bold" lineLimit={1}>
            标签页收藏
          </Text>
        </HStack>

        <Spacer />

        <Text
          font={52}
          fontWeight="bold"
          fontDesign="rounded"
          foregroundStyle="systemBlue"
          lineLimit={1}
          minScaleFactor={0.7}
        >
          {String(total)}
        </Text>
        <Text font="headline" fontWeight="semibold" foregroundStyle="secondaryLabel">
          已收藏网页
        </Text>

        <Spacer />
      </VStack>
    </Link>
  )
}

function RecentRow({ item }: { item: RecentBookmark }) {
  const { bookmark, groupName } = item
  let domain = bookmark.url
  try {
    domain = new URL(bookmark.url).hostname.replace(/^www\./, "")
  } catch {}

  return (
    <Link url={bookmark.url} buttonStyle="plain">
      <HStack spacing={9}>
        <Image systemName="safari" foregroundStyle="systemBlue" font={16} />
        <VStack alignment="leading" spacing={2}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>
            {bookmark.title || domain}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {`${groupName} · ${domain}`}
          </Text>
        </VStack>
        <Spacer />
        <Image systemName="arrow.up.right" foregroundStyle="tertiaryLabel" font="caption2" />
      </HStack>
    </Link>
  )
}

function MediumWidget({ store }: { store: Store }) {
  const recent = recentBookmarks(store)

  return (
    <VStack padding={14} alignment="leading" spacing={8}>
      <HStack spacing={7}>
        <Link url={Script.createRunSingleURLScheme("Tabs Saver")} buttonStyle="plain">
          <HStack spacing={7}>
            <Image systemName="bookmark.fill" foregroundStyle="systemBlue" font={19} />
            <Text font="headline" fontWeight="bold">最近收藏</Text>
            <Spacer />
          </HStack>
        </Link>
      </HStack>

      {recent.length > 0 ? (
        <VStack alignment="leading" spacing={8}>
          {recent.map(item => (
            <RecentRow key={item.bookmark.id} item={item} />
          ))}
        </VStack>
      ) : (
        <VStack alignment="center" spacing={6}>
          <Spacer />
          <Image systemName="bookmark" foregroundStyle="secondaryLabel" font={24} />
          <Text font="subheadline" foregroundStyle="secondaryLabel">还没有收藏网页</Text>
          <Spacer />
        </VStack>
      )}
    </VStack>
  )
}

async function runWidget() {
  const store = await loadStore()
  const view = Widget.family === "systemSmall"
    ? <SmallWidget store={store} />
    : <MediumWidget store={store} />
  Widget.present(view, { policy: "never" })
}

runWidget()
