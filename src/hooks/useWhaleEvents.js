import { useState, useEffect } from "react";
import { getWhaleEvents, subscribeWhaleActivity } from "../utils/whaleActivityStore";

export function useWhaleEvents(mint) {
  const [events, setEvents] = useState(() => getWhaleEvents(mint));

  useEffect(() => {
    setEvents(getWhaleEvents(mint));
    return subscribeWhaleActivity(() => {
      setEvents(getWhaleEvents(mint));
    });
  }, [mint]);

  return events;
}
