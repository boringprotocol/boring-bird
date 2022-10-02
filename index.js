/* ================================================================================

	boring-bird.
  
  Based of the Notion SDK examples, this sends a tweet from Notion databases

================================================================================ */

const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
// const twitter = require('twitter-lite') // Moving away from Twitter-lite to Twitter-API-V2
const { TwitterApi } = require("twitter-api-v2")

dotenv.config()
/* Connect to Twitter */
// const client = new twitter(config) // TRying Twitter-API-v2
const client = new TwitterApi({
  appKey: process.env.CONSUMER_KEY,
  appSecret: process.env.CONSUMER_SECRET,
  accessToken: process.env.ACCESS_TOKEN_KEY,
  accessSecret: process.env.ACCESS_TOKEN_SECRET,
})
/* Connect to Notion */
const notion = new Client({ auth: process.env.NOTION_KEY })

const databaseId = process.env.NOTION_DATABASE_ID

/**
 * Local map to store Entry pageId to its last status.
 * { [pageId: string]: string }
 */
const EntryPageIdToStatusMap = {}

/**
 * Initialize local data store.
 * Then poll for changes every 5 seconds (5000 milliseconds).
 */
setInitialEntryPageIdToStatusMap().then(() => {
  setInterval(findAndSendTweetsForUpdatedEntries, 5000)
})

/**
 * Get and set the initial data store with Entries currently in the database.
 */
async function setInitialEntryPageIdToStatusMap() {
  const currentEntries = await getEntriesFromNotionDatabase()
  for (const { pageId, status } of currentEntries) {
    EntryPageIdToStatusMap[pageId] = status
  }
}

async function findAndSendTweetsForUpdatedEntries() {
  // Get the Entries currently in the database.
  console.log("\nFetching Entries from Notion DB...")
  const currentEntries = await getEntriesFromNotionDatabase()

  // Return any Entries that have had their status updated.
  const updatedEntries = findUpdatedEntries(currentEntries)
  console.log(`Found ${updatedEntries.length} updated Entries.`)

  // For each updated Entry, update EntryPageIdToStatusMap and send an email notification.
  for (const Entry of updatedEntries) {
    EntryPageIdToStatusMap[Entry.pageId] = Entry.status
    await sendTweettoTwitter(Entry)
  }
}

/**
 * Gets Entries from the database.
 *
 * @returns {Promise<Array<{ pageId: string, status: string, title: string }>>}
 */
async function getEntriesFromNotionDatabase() {
  const pages = []
  let cursor = undefined

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    })
    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  console.log(`${pages.length} pages successfully fetched.`)

  const Entries = []
  for (const page of pages) {
    const pageId = page.id

    const statusPropertyId = page.properties["Status"].id
    const statusPropertyItem = await getPropertyValue({
      pageId,
      propertyId: statusPropertyId,
    })
    const status = statusPropertyItem.select
      ? statusPropertyItem.select.name
      : "No Status"

    const titlePropertyId = page.properties["Tweet"].id
    const titlePropertyItems = await getPropertyValue({
      pageId,
      propertyId: titlePropertyId,
    })
    const title = titlePropertyItems
      .map(propertyItem => propertyItem.title.plain_text)
      .join("")

    Entries.push({ pageId, status, title })
  }

  return Entries
}

/**
 * Compares Entry to most recent version of Entry stored in EntryPageIdToStatusMap.
 * Returns any Entries that have a different status than their last version.
 *
 * @param {Array<{ pageId: string, status: string, title: string }>} currentEntries
 * @returns {Array<{ pageId: string, status: string, title: string }>}
 */
function findUpdatedEntries(currentEntries) {
  return currentEntries.filter(currentEntry => {
    const previousStatus = getPreviousEntriestatus(currentEntry)
    /* If current entry status is not same as previous Status and current status is Ready, this makes it ready to Tweet */
    return (currentEntry.status !== previousStatus && currentEntry.status === "Ready")
  })
}

/**
 * Sends tweet using Twitter-Lite.
 *
 * @param {{ status: string, title: string }} Entry
 */
async function sendTweettoTwitter({ title, status }) {
  const message = `Status of Notion Entry ("${title}") has been updated to "${status}".`
  console.log(message)

  client.v1.tweet({ status: title }).then((val) => {
    console.log(val)
    console.log("success")
}).catch((err) => {
    console.log(err)
})
  
}

/**
 * Finds or creates Entry in local data store and returns its status.
 * @param {{ pageId: string; status: string }} Entry
 * @returns {string}
 */
function getPreviousEntriestatus({ pageId, status }) {
  // If this Entry hasn't been seen before, add to local pageId to status map.
  if (!EntryPageIdToStatusMap[pageId]) {
    EntryPageIdToStatusMap[pageId] = status
  }
  return EntryPageIdToStatusMap[pageId]
}

/**
 * If property is paginated, returns an array of property items.
 *
 * Otherwise, it will return a single property item.
 *
 * @param {{ pageId: string, propertyId: string }}
 * @returns {Promise<PropertyItemObject | Array<PropertyItemObject>>}
 */
async function getPropertyValue({ pageId, propertyId }) {
  const propertyItem = await notion.pages.properties.retrieve({
    page_id: pageId,
    property_id: propertyId,
  })
  if (propertyItem.object === "property_item") {
    return propertyItem
  }

  // Property is paginated.
  let nextCursor = propertyItem.next_cursor
  const results = propertyItem.results

  while (nextCursor !== null) {
    const propertyItem = await notion.pages.properties.retrieve({
      page_id: pageId,
      property_id: propertyId,
      start_cursor: nextCursor,
    })

    nextCursor = propertyItem.next_cursor
    results.push(...propertyItem.results)
  }

  return results
}
