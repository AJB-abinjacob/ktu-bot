import * as cron from "node-cron";
import fetchAnnouncements from "@services/fetchAnnouncements";
import { readFile, writeFile } from "node:fs/promises";
import fetchAttachment from "@/services/fetchAttachment";
import { Announcement, Attachment, JobData } from "@/types/types";
import findFilters from "@/utils/findFilters";
import getCaptionMsg from "@/utils/getCaptionMsg";
import db from "@/db/initDb";
import getRelevancy from "@/services/getRelevancy";
import queue from "@/queues/notiyUserQueue/queue";

const CRON_JOB_INTERVAL = "*/15 * * * *";

// Type of the notification job in the notification job queue
interface NotifJobs {
  name: string;
  data: JobData;
  opts: {
    removeOnComplete: boolean;
    removeOnFail: boolean;
  };
}

async function notifyUserCron() {
  console.log("Cron job initialized");

  // Schedule a cron job to run every 15 minutes
  cron.schedule(CRON_JOB_INTERVAL, async () => {
    // Log the start time of the cron job
    const startTime = new Date().toString();
    console.log(`🔴 Cron job started at ${startTime}`);

    // Read the json file to get the previous announcements
    // If the file does not exist, fetch the announcements and write to the file
    let data;
    try {
      data = await readFile("data.json", "utf8");
      if (!data) {
        const announcements = JSON.stringify(await fetchAnnouncements(0, 10));
        await writeFile("data.json", announcements, "utf8");
        return;
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        const announcements = JSON.stringify(await fetchAnnouncements(0, 10));
        await writeFile("data.json", announcements, "utf8");
        return;
      }
    }

    if (!data) {
      return;
    }

    try {
      const announcements: Announcement[] = await fetchAnnouncements(0, 10);
      const previousAnnouncements: Announcement[] = JSON.parse(data);
      let diff: Announcement[] = [];

      // hacky way to compare if both are equal :)
      if (
        JSON.stringify(announcements) !== JSON.stringify(previousAnnouncements)
      ) {
        const previousAnnouncementIds = new Set(
          previousAnnouncements.map((a: Announcement) => a.id)
        );

        // Get the new announcements
        diff = announcements.filter(
          (announcement: Announcement) =>
            !previousAnnouncementIds.has(announcement.id)
        );

        // Replace the old data.json with the new announcements
        await writeFile("data.json", JSON.stringify(announcements), "utf8");

        // Get all the chatIds
        const usersRef = db.collection("subscribedUsers");

        // Loop through each new annoucement
        for (const announcement of diff) {
          // Find the filters based on subject
          const filters = findFilters(announcement.subject);

          let snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;

          // Find all the chatIds that match the filters
          // If no filters were matched, check if it is relevant or not first
          // If it is relevant, send to all users
          // If not relevant send to users with ALL filter only
          if (filters.length === 1 && filters[0] === "general") {
            const relevancy = await getRelevancy(announcement.subject);
            console.log(
              `➡️  Announcement : ${announcement.subject} Relevancy : ${relevancy}`
            );
            if (relevancy) {
              snapshot = await usersRef.get();
            } else {
              snapshot = await usersRef
                .where("courseFilter", "==", "all")
                .get();
            }
          } else {
            // If already matched by a course filter, then it is definitely relevant
            // So send it to all users with the course filter, ALL filter and relevant filter
            snapshot = await usersRef
              .where("courseFilter", "in", [...filters, "all", "relevant"])
              .get();
          }

          const chatIds = snapshot.docs.map((doc) => doc.data().chatId);

          // If there are no chatIds for this filter, then skip this announcement
          if (chatIds.length === 0) {
            continue;
          }

          // Get the caption message
          const captionMsg = getCaptionMsg(announcement);

          // Get the data to fetch the attachments
          const attachments = announcement.attachments.map(
            (attachment: Attachment) => ({
              name: attachment.name,
              encryptId: attachment.encryptId,
            })
          );

          // Loop through each chatId, add it to the job array
          // And then add the jobs to the queue in bulk at the end (this saves IO operations)
          if (attachments.length === 0) {
            const name = `msg-${captionMsg.slice(5)}`;
            let jobs: NotifJobs[] = [];
            for (let i = 0; i < chatIds.length; i++) {
              // Keep filename and file as null since there are no attachments
              jobs.push({
                name: name,
                data: {
                  chatId: chatIds[i],
                  captionMsg: captionMsg,
                  fileName: null,
                  file: null,
                },
                opts: {
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              });
            }
            await queue.addBulk(jobs);
          } else {
            // Loop through each attachment, fetch the file and add it to the job array for each chatId
            // And then add the jobs to the queue in bulk at the end (this saves IO operations)
            let jobs: NotifJobs[] = [];
            for (let i = 0; i < attachments.length; i++) {
              const file = await fetchAttachment(attachments[i].encryptId);
              const name = `msg-${captionMsg.slice(5)}-attach-${i}`;
              for (let j = 0; j < chatIds.length; j++) {
                jobs.push({
                  name: name,
                  data: {
                    chatId: chatIds[j],
                    file: file,
                    captionMsg: captionMsg,
                    fileName: attachments[i].name,
                  },
                  opts: {
                    removeOnComplete: true,
                    removeOnFail: true,
                  },
                });
              }
            }
            await queue.addBulk(jobs);
          }
        }
      }
    } catch (error) {
      console.error(error);
    }
  });
}

export default notifyUserCron;
