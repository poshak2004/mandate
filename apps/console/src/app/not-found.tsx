import { Empty, TextLink } from "@/components/ui";

export default function NotFound() {
  return (
    <Empty>
      Not found. <TextLink href="/">Back to the overview</TextLink>
    </Empty>
  );
}
