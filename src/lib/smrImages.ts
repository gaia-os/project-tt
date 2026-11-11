import { TopicKey } from '@/lib/topicConfig';

/** URL of an image stored in the topic's `images` collection. */
export function topicImageUrl(topic: TopicKey, imageId: string): string {
  return `/investment-tech-tree/api/images/${encodeURIComponent(imageId)}?topic=${topic}`;
}
