import * as Y from 'yjs'
import { Electric } from '../generated/client'
import { YDocMaterializer } from './y-electricsql/materializer'
import { extractTextFromXmlFragment } from './y-electricsql/utils'

export function makeMaterializer(client: Electric) {
  const materializer = new YDocMaterializer(client)
  materializer.addMaterializer('issue', async ({ ydocId, ydoc }) => {
    console.log('Materilize', ydocId)
    const description = ydoc.getXmlFragment('description')
    const descriptionText = description
      ? extractTextFromXmlFragment(description)
      : ''
    const title = ydoc.getXmlFragment('title')
    const titleText = title ? extractTextFromXmlFragment(title) : ''
    client.db.issue.updateMany({
      where: {
        ydoc_id: ydocId,
      },
      data: {
        description: descriptionText,
        title: titleText,
      },
    })

    const issueIds = (
      await client.db.issue.findMany({
        where: {
          ydoc_id: ydocId,
        },
        select: {
          id: true,
        },
      })
    ).map((issue) => issue.id)

    // Get mention ids
    const mentionIds = new Set<string>()
    for (const node of description.createTreeWalker(
      (node) =>
        node instanceof Y.XmlElement && node.nodeName === 'mention'
    )) {
      const id = (node as Y.XmlElement).getAttribute('id')
      if (id) {
        mentionIds.add(id)
      }
    }

    // Update mentions
    for (const issueId of issueIds) {
      // Get existing mentions
      // const existingMentionedIds = new Set(
      //   (
      //     await client.db.related_issue.findMany({
      //       where: {
      //         issue_id_1: issueId,
      //       },
      //       select: {
      //         issue_id_2: true,
      //       },
      //     })
      //   ).map((mention) => mention.issue_id_2)
      // )

      // Insert new mentions
      // for (const mentionId of mentionIds) {
      //   if (!existingMentionedIds.has(mentionId)) {
      //     console.log('UUID MADE', xorUUIDs(issueId, mentionId))
      //     await client.db.related_issue.create({
      //       data: {
      //         id: xorUUIDs(issueId, mentionId), // UUID that is deterministic based on the two issue ids
      //         issue_id_1: issueId,
      //         issue_id_2: mentionId,
      //       },
      //     })
      //   }
      // }
      if (mentionIds.size > 0) {
        const count = await client.db.related_issue.createMany({
          data: Array.from(mentionIds).map((mentionId) => ({
            id: xorUUIDs(issueId, mentionId),
            issue_id_1: issueId,
            issue_id_2: mentionId,
          })),
          skipDuplicates: true,
        })
        console.log('COUNT', count)
      }
      
      // Delete mentions that are no longer in the document
      console.log(await client.db.related_issue.findMany({
        where: {
          AND: [
            {
              issue_id_1: issueId,
            },
            {
              NOT: {
                issue_id_2: {
                  in: [...mentionIds],
                },
              },
            },
          ],
        },
      }))
      const deleted = await client.db.related_issue.deleteMany({
        where: {
          AND: [
            {
              issue_id_1: issueId,
            },
            {
              NOT: {
                issue_id_2: {
                  in: [...mentionIds],
                },
              },
            },
          ],
        },
      })
      console.log('DELETED', deleted)
      console.log(await client.db.related_issue.findMany())
    }
  })
  return materializer
}

function xorUUIDs(uuid1: string, uuid2: string) {
  const uuid1Bytes = uuidStringToByteArray(uuid1);
  const uuid2Bytes = uuidStringToByteArray(uuid2);
  const resultBytes = uuid1Bytes.map((byte, index) => byte ^ uuid2Bytes[index]);
  return byteArrayToUUIDString(resultBytes);
}

function uuidStringToByteArray(uuid: string) {
  const hexString = uuid.replace(/-/g, "");
  const byteArray: number[] = [];
  for (let i = 0; i < hexString.length; i += 2) {
    byteArray.push(parseInt(hexString.slice(i, i+2), 16));
  }
  return byteArray;
}

function byteArrayToUUIDString(byteArray: number[]) {
  const hexChars = byteArray
    .map((byte) => ("0" + byte.toString(16)).slice(-2))
    .join("");
  return [
    hexChars.slice(0, 8),
    hexChars.slice(8, 12),
    hexChars.slice(12, 16),
    hexChars.slice(16, 20),
    hexChars.slice(20),
  ].join("-")
}
