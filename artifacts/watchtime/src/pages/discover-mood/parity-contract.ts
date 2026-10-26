import type {
  AccessType as WebAccessType,
  Availability as WebAvailability,
  ContentKey as WebContentKey,
  Context as WebContext,
  Filters as WebFilters,
  MoodImportance as WebMoodImportance,
  MoodKey as WebMoodKey,
  Movie as WebMovie,
  Region as WebRegion,
  ResultSort as WebResultSort,
  Session as WebSession,
  StoreState as WebStoreState,
  Viewed as WebViewed,
} from "./types";
import type {
  AccessType as MobileAccessType,
  Availability as MobileAvailability,
  ContentKey as MobileContentKey,
  Context as MobileContext,
  Filters as MobileFilters,
  MoodImportance as MobileMoodImportance,
  MoodKey as MobileMoodKey,
  Movie as MobileMovie,
  Region as MobileRegion,
  ResultSort as MobileResultSort,
  Session as MobileSession,
  StoreState as MobileStoreState,
  Viewed as MobileViewed,
} from "../../../../watchtime-mobile/lib/discover-mood/types";

type Assert<T extends true> = T;
type Equivalent<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

// This file is included in the web typecheck so shared domain type drift fails CI.
export type MoodTypeParity = [
  Assert<Equivalent<WebAccessType, MobileAccessType>>,
  Assert<Equivalent<WebAvailability, MobileAvailability>>,
  Assert<Equivalent<WebContentKey, MobileContentKey>>,
  Assert<Equivalent<WebContext, MobileContext>>,
  Assert<Equivalent<WebFilters, MobileFilters>>,
  Assert<Equivalent<WebMoodImportance, MobileMoodImportance>>,
  Assert<Equivalent<WebMoodKey, MobileMoodKey>>,
  Assert<Equivalent<WebMovie, MobileMovie>>,
  Assert<Equivalent<WebRegion, MobileRegion>>,
  Assert<Equivalent<WebResultSort, MobileResultSort>>,
  Assert<Equivalent<WebSession, MobileSession>>,
  Assert<Equivalent<WebStoreState, Omit<MobileStoreState, "hydrated">>>,
  Assert<Equivalent<WebViewed, MobileViewed>>,
];
