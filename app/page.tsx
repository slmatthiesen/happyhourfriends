import { redirect } from "next/navigation";

// `/` redirects to the default city (PRD §6.2). Multi-city: this becomes a
// city picker / geo-detect later.
export default function Home() {
  redirect("/tacoma");
}
