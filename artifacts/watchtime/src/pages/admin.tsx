import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import {
  useGetMe,
  useGetAdminDashboard,
  useListAdminContributions,
  useUpdateAdminContribution,
  useListAdminReports,
  useUpdateAdminReport,
  useListAdminFeedback,
  useUpdateAdminFeedback,
  useListAdminIntegrations,
  useListCatalogRefreshes,
  useStartCatalogRefresh,
  useRetryCatalogRefresh,
  useGetAdminAnalytics,
  useSearchAdminContent,
  useGetAdminContentMappingCounts,
  useCorrectAdminUnclassifiedRating,
  useDismissAdminUnclassifiedRating,
  useListAdminContentAliases,
  useUpdateAdminContentAlias,
  useDeleteAdminContentAlias,
  useRefreshAdminContent,
  useRefreshAdminContentBatch,
  useGetAdminContentRefreshBatch,
  useListAdminContentRefreshBatchHistory,
  useListAdminWikidataIdentityConflicts,
  useReviewAdminWikidataIdentityConflict,
  useGetAdminAuditLog,
  getGetAdminDashboardQueryKey,
  getListAdminIntegrationsQueryKey,
  getListAdminContributionsQueryKey,
  getListAdminReportsQueryKey,
  getListAdminFeedbackQueryKey,
  getSearchAdminContentQueryKey,
  getGetAdminContentMappingCountsQueryKey,
  getListAdminContentAliasesQueryKey,
  getListCatalogRefreshesQueryKey,
  getGetAdminContentRefreshBatchQueryKey,
  getListAdminContentRefreshBatchHistoryQueryKey,
  getListAdminWikidataIdentityConflictsQueryKey,
  lookupAdminContentAliasCollisions,
  type AdminContentRefreshBatch,
  type AdminContentRefreshBatchHistoryEntry,
  type AdminWikidataIdentityConflict,
  type AdminContentAlias,
  type AdminContentAliasCollisionCount,
  type AdminContentAliasPage,
  type AdminContentAliasRecord,
  type AdminUnclassifiedRatingCorrection,
  type ContentMapping,
  type IntegrationHealth,
  type ListAdminContentAliasesOwnership,
} from "@workspace/api-client-react";
import { RATING_REGIONS, type RatingRegion } from "@workspace/rating-regions";
import { buildSafetySyncReportCsv } from "@/lib/safety-sync-report";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import {
  adminContentUrl,
  readAdminContentUrl,
  type AdminTab,
  type AliasOwnershipFilter,
  type MappingStatusFilter,
} from "./admin-content-url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  Users,
  Database,
  Server,
  Activity,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Search,
  BarChart2,
  CheckCheck,
  ThumbsDown,
  Flag,
  Eye,
  TrendingUp,
  Film,
  BookOpen,
  ClipboardList,
  Link2,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Save,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";

const ALIAS_REFRESH_RECOVERY_TIMEOUT_MS = 30_000;
const MODERATION_QUEUE_PAGE_SIZE = 50;
const ADMIN_CONTENT_ALIAS_COLLISION_QUERY_KEY =
  "/api/admin/content-alias-collisions";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const {
    tab,
    region,
    q,
    ownership,
    malformedRefreshTimestamp,
    malformedRegionalClassification,
    malformedRefreshTimestampProvider,
    malformedRefreshTimestampAllRegions,
    mappingProvider,
    mappingStatus,
    contentOffset,
    aliasId,
    aliasPage,
    aliasCursor,
  } = readAdminContentUrl(search);
  const [hasVisitedContentTab, setHasVisitedContentTab] = useState(
    tab === "content",
  );
  const contentAliasReviewFilters = React.useRef({ q, ownership });
  const contentReviewQuery =
    tab === "content" ? q : contentAliasReviewFilters.current.q;
  const contentReviewOwnership =
    tab === "content" ? ownership : contentAliasReviewFilters.current.ownership;
  React.useEffect(() => {
    if (tab === "content") {
      setHasVisitedContentTab(true);
      contentAliasReviewFilters.current = { q, ownership };
    }
  }, [tab, q, ownership]);
  const selectTab = (nextTab: string) => {
    if (nextTab === "content") {
      setHasVisitedContentTab(true);
      const filters = contentAliasReviewFilters.current;
      setLocation(
        adminContentUrl(search, "content", region, filters.q, filters.ownership),
      );
      return;
    }
    setLocation(adminContentUrl(search, nextTab as AdminTab, region));
  };
  const selectRegion = (nextRegion: RatingRegion) => {
    setLocation(adminContentUrl(search, "content", nextRegion, undefined, undefined, undefined, undefined, 0));
  };
  const selectContentSearch = (term: string) => {
    setLocation(adminContentUrl(search, "content", region, term, undefined, undefined, undefined, 0), { replace: true });
  };
  const selectAliasOwnership = (nextOwnership: AliasOwnershipFilter) => {
    setLocation(adminContentUrl(search, "content", region, undefined, nextOwnership));
  };
  const selectMalformedRefreshTimestamp = (enabled: boolean) => {
    setLocation(adminContentUrl(
      search,
      "content",
      region,
      undefined,
      undefined,
      undefined,
      enabled,
      0,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      false,
    ));
  };
  const selectMalformedRegionalClassification = (enabled: boolean) => {
    setLocation(adminContentUrl(
      search,
      "content",
      region,
      undefined,
      undefined,
      undefined,
      false,
      0,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      enabled,
    ));
  };
  const selectMalformedRefreshTimestampAllRegions = (enabled: boolean) => {
    setLocation(adminContentUrl(
      search, "content", region, undefined, undefined, undefined, undefined,
      0, undefined, undefined, undefined, enabled,
    ));
  };
  const selectContentPage = (offset: number) => {
    setLocation(adminContentUrl(search, "content", region, undefined, undefined, undefined, undefined, offset));
  };
  const selectContentMappingProvider = (nextProvider: string) => {
    setLocation(adminContentUrl(
      search, "content", region, undefined, undefined, undefined, undefined,
      0, undefined, undefined, undefined, undefined, nextProvider, mappingStatus,
    ));
  };
  const selectContentMappingStatus = (nextStatus: MappingStatusFilter) => {
    setLocation(adminContentUrl(
      search, "content", region, undefined, undefined, undefined, undefined,
      0, undefined, undefined, undefined, undefined, mappingProvider, nextStatus,
    ));
  };
  const selectAliasPage = (page: number, cursor: string | null) => {
    setLocation(adminContentUrl(
      search,
      "content",
      region,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      page,
      cursor,
    ));
  };
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: dashboard } = useGetAdminDashboard({
    query: { enabled: !!me?.isAdmin, queryKey: getGetAdminDashboardQueryKey() },
  });
  const {
    data: integrations,
    isLoading: integrationsLoading,
  } = useListAdminIntegrations({
    query: {
      enabled: !!me?.isAdmin,
      queryKey: getListAdminIntegrationsQueryKey(),
    },
  });
  const reviewMalformedTimestampsUrl = (provider: string) =>
    adminContentUrl(
      search,
      "content",
      region,
      "",
      "all",
      undefined,
      true,
      0,
      provider,
      undefined,
      undefined,
      true,
    );
  const reviewUnclassifiedRatingsUrl = (provider: string) =>
    adminContentUrl(
      search,
      "content",
      region,
      "",
      "all",
      undefined,
      false,
      0,
      provider,
      undefined,
      undefined,
      false,
      "",
      "all",
      true,
    );

  if (meLoading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  if (!me?.isAdmin) return <Redirect to="/" />;

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 min-h-screen">
      <header className="mb-8 flex items-center gap-4">
        <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-lg">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Admin Portal
          </h1>
          <p className="text-muted-foreground font-medium">
            WatchTime Management Console
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={selectTab} className="w-full">
        <TabsList className="bg-secondary/50 p-1 rounded-xl mb-8 flex-wrap h-auto gap-1">
          <TabsTrigger
            value="dashboard"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <Activity className="w-4 h-4 mr-1.5" /> Dashboard
          </TabsTrigger>
          <TabsTrigger
            value="moderation"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <CheckCircle className="w-4 h-4 mr-1.5" /> Moderation
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <AlertTriangle className="w-4 h-4 mr-1.5" /> Reports
          </TabsTrigger>
          <TabsTrigger
            value="feedback"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <MessageSquare className="w-4 h-4 mr-1.5" /> Feedback
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <BarChart2 className="w-4 h-4 mr-1.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger
            value="content"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <Database className="w-4 h-4 mr-1.5" /> Content
          </TabsTrigger>
          <TabsTrigger
            value="integrations"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <Server className="w-4 h-4 mr-1.5" /> Integrations
          </TabsTrigger>
          <TabsTrigger
            value="audit-log"
            className="rounded-lg data-[state=active]:bg-background"
          >
            <ClipboardList className="w-4 h-4 mr-1.5" /> Audit Log
          </TabsTrigger>
        </TabsList>

        {/* Dashboard */}
        <TabsContent value="dashboard" className="outline-none">
          {integrations?.some(
            (integration) => integration.malformedRefreshTimestampCount > 0,
          ) && (
            <section
              aria-labelledby="malformed-rating-timestamp-alerts"
              className="mb-6 rounded-2xl border border-orange-300 bg-orange-50 p-5 text-orange-900 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200"
            >
              <h2
                id="malformed-rating-timestamp-alerts"
                className="text-lg font-display font-bold"
              >
                Malformed rating timestamp alerts
              </h2>
              <p className="mt-1 text-sm">
                These data-quality warnings do not change provider health
                status.
              </p>
              <p className="mt-1 text-sm">
                Counts include malformed provider records without a supported
                regional classification. The separate unclassified review keeps
                those records out of regional results and lets you inspect them.
              </p>
              <ul className="mt-4 space-y-3">
                {integrations
                  .filter(
                    (integration) =>
                      integration.malformedRefreshTimestampCount > 0,
                  )
                  .map((integration) => (
                    <li
                      key={integration.provider}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-background/70 p-3 dark:border-orange-900"
                    >
                      <span className="font-medium">
                        {integration.provider}:{" "}
                        {integration.malformedRefreshTimestampCount.toLocaleString()}{" "}
                        {integration.malformedRefreshTimestampCount === 1
                          ? "malformed rating"
                          : "malformed ratings"}
                        {" · "}
                        {(integration.malformedRefreshTimestampUnclassifiedCount ?? 0).toLocaleString()}{" "}
                        without a supported regional classification
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="border-orange-400 text-orange-900 dark:border-orange-700 dark:text-orange-200"
                        >
                          <Link href={reviewMalformedTimestampsUrl(integration.provider)}>
                            Review regional ratings
                          </Link>
                        </Button>
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="border-orange-400 text-orange-900 dark:border-orange-700 dark:text-orange-200"
                        >
                          <Link href={reviewUnclassifiedRatingsUrl(integration.provider)}>
                            Review unclassified
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          {dashboard ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatCard
                title="Total Users"
                value={dashboard.totalUsers}
                icon={Users}
                trend={`+${dashboard.newRegistrations7d} this week`}
              />
              <StatCard
                title="Titles in Catalog"
                value={dashboard.titlesInCatalog}
                icon={Database}
              />
              <StatCard
                title="Safety Coverage"
                value={`${Math.round(dashboard.safetyCoveragePercent)}%`}
                icon={ShieldAlert}
              />
              <StatCard
                title="Pending Contributions"
                value={dashboard.pendingContributions}
                icon={CheckCircle}
                color={
                  dashboard.pendingContributions > 0
                    ? "text-yellow-600"
                    : "text-green-600"
                }
              />
              <StatCard
                title="Open Reports"
                value={dashboard.openReports}
                icon={AlertTriangle}
                color={
                  dashboard.openReports > 0 ? "text-red-600" : "text-green-600"
                }
              />
              <StatCard
                title="Failed Syncs"
                value={dashboard.failedSyncs}
                icon={XCircle}
                color={
                  dashboard.failedSyncs > 0 ? "text-red-600" : "text-green-600"
                }
              />
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-3xl" />
          )}
        </TabsContent>

        {/* Moderation */}
        <TabsContent value="moderation" className="outline-none">
          <ModerationTab />
        </TabsContent>

        {/* Reports */}
        <TabsContent value="reports" className="outline-none">
          <ReportsTab />
        </TabsContent>

        {/* Feedback */}
        <TabsContent value="feedback" className="outline-none">
          <FeedbackTab />
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="outline-none">
          <AnalyticsTab />
        </TabsContent>

        {/* Content */}
        <TabsContent
          value="content"
          forceMount={hasVisitedContentTab ? true : undefined}
          className="outline-none"
        >
          <ContentTab
            ratingRegion={region}
            onRatingRegionChange={selectRegion}
            q={contentReviewQuery}
            onSearchChange={selectContentSearch}
            aliasOwnership={contentReviewOwnership}
            onAliasOwnershipChange={selectAliasOwnership}
            malformedRefreshTimestamp={malformedRefreshTimestamp}
            malformedRegionalClassification={malformedRegionalClassification}
            malformedRefreshTimestampProvider={malformedRefreshTimestampProvider}
            malformedRefreshTimestampAllRegions={malformedRefreshTimestampAllRegions}
            mappingProvider={mappingProvider}
            mappingStatus={mappingStatus}
            onMappingProviderChange={selectContentMappingProvider}
            onMappingStatusChange={selectContentMappingStatus}
            onMalformedRefreshTimestampChange={selectMalformedRefreshTimestamp}
            onMalformedRegionalClassificationChange={selectMalformedRegionalClassification}
            onMalformedRefreshTimestampAllRegionsChange={selectMalformedRefreshTimestampAllRegions}
            contentOffset={contentOffset}
            onContentOffsetChange={selectContentPage}
            reviewUrl={adminContentUrl(
              search,
              "content",
              region,
              contentReviewQuery,
              contentReviewOwnership,
              undefined,
              malformedRefreshTimestamp,
              contentOffset,
              malformedRefreshTimestampProvider,
              undefined,
              undefined,
              malformedRefreshTimestampAllRegions,
              mappingProvider,
              mappingStatus,
            )}
            aliasId={aliasId}
            aliasPage={aliasPage}
            aliasCursor={aliasCursor}
            onAliasPageChange={selectAliasPage}
          />
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="outline-none">
          <IntegrationsTab
            integrations={integrations}
            isLoading={integrationsLoading}
            reviewMalformedTimestampsUrl={reviewMalformedTimestampsUrl}
          />
        </TabsContent>

        {/* Audit Log */}
        <TabsContent value="audit-log" className="outline-none">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Shared helpers ─── */

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  color = "text-primary",
}: any) {
  return (
    <div className="bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        <div className={`p-2 rounded-xl bg-secondary/50 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-display font-bold text-foreground">
          {value}
        </span>
        {trend && (
          <span className="text-sm font-medium text-green-600">{trend}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    approved:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    flagged:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    resolved:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    dismissed: "bg-secondary text-muted-foreground",
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    reviewing:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    closed: "bg-secondary text-muted-foreground",
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${map[status] ?? "bg-secondary text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  desc,
}: {
  icon: any;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground shadow-sm">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-20" />
      <h3 className="text-lg font-display font-medium text-foreground mb-1">
        {title}
      </h3>
      <p className="text-sm">{desc}</p>
    </div>
  );
}

/* ─── Moderation ─── */

export function ModerationTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [offset, setOffset] = useState(0);
  const { data: contributions, isLoading } = useListAdminContributions(
    {
      ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
      limit: MODERATION_QUEUE_PAGE_SIZE + 1,
      offset,
    },
  );
  const visibleContributions = contributions?.slice(0, MODERATION_QUEUE_PAGE_SIZE) ?? [];
  const updateContribution = useUpdateAdminContribution();

  const mod = (contributionId: number, status: string) =>
    updateContribution.mutate(
      { contributionId, data: { status: status as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({
            queryKey: getListAdminContributionsQueryKey(),
          });
          qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          toast({ title: `Contribution ${status}` });
        },
        onError: () =>
          toast({ title: "Action failed", variant: "destructive" }),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold">
          Community Contributions
        </h2>
        <Select value={statusFilter} onValueChange={(value) => {
          setStatusFilter(value);
          setOffset(0);
        }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !visibleContributions.length ? (
        <EmptyState
          icon={CheckCircle}
          title="No contributions"
          desc={`No ${statusFilter} contributions at the moment.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleContributions.map((c) => (
            <div
              key={c.id}
              className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-bold text-foreground truncate">
                    {c.titleName}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-2">
                  <span>
                    Category:{" "}
                    <span className="font-medium text-foreground capitalize">
                      {c.category}
                    </span>
                  </span>
                  <span>
                    Severity:{" "}
                    <span className="font-medium text-foreground capitalize">
                      {c.severity}
                    </span>
                  </span>
                  {c.seasonNumber && (
                    <span>
                      S{c.seasonNumber}
                      {c.episodeNumber ? `E${c.episodeNumber}` : ""}
                    </span>
                  )}
                </div>
                {c.description && (
                  <p className="text-sm text-foreground/80 italic">
                    "{c.description}"
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              {c.status === "pending" || c.status === "flagged" ? (
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="bg-green-600 hover:bg-green-700 text-white rounded-xl"
                    onClick={() => mod(c.id, "approved")}
                    disabled={updateContribution.isPending}
                  >
                    <CheckCheck className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
                    onClick={() => mod(c.id, "rejected")}
                    disabled={updateContribution.isPending}
                  >
                    <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                  {c.status !== "flagged" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      onClick={() => mod(c.id, "flagged")}
                      disabled={updateContribution.isPending}
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ) : c.status === "approved" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20 flex-shrink-0"
                  onClick={() => mod(c.id, "rejected")}
                  disabled={updateContribution.isPending}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <AdminQueuePagination
        offset={offset}
        pageSize={MODERATION_QUEUE_PAGE_SIZE}
        resultCount={contributions?.length ?? 0}
        isLoading={isLoading}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

/* ─── Reports ─── */

function AdminQueuePagination({
  offset,
  pageSize,
  resultCount,
  isLoading,
  onOffsetChange,
}: {
  offset: number;
  pageSize: number;
  resultCount: number;
  isLoading: boolean;
  onOffsetChange: (offset: number) => void;
}) {
  if (offset === 0 && resultCount <= pageSize) return null;

  return (
    <nav
      className="flex items-center justify-center gap-3"
      aria-label="Moderation queue pagination"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-xl gap-1.5"
        onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        disabled={offset === 0 || isLoading}
      >
        <ChevronLeft className="w-4 h-4" /> Previous
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        Page {Math.floor(offset / pageSize) + 1}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-xl gap-1.5"
        onClick={() => onOffsetChange(offset + pageSize)}
        disabled={resultCount <= pageSize || isLoading}
      >
        Next <ChevronRight className="w-4 h-4" />
      </Button>
    </nav>
  );
}

export function ReportsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [offset, setOffset] = useState(0);
  const { data: reports, isLoading, isFetching, isSuccess } = useListAdminReports({
    ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
    limit: MODERATION_QUEUE_PAGE_SIZE + 1,
    offset,
  } as any);
  const updateReport = useUpdateAdminReport();
  const visibleReports = reports?.slice(0, MODERATION_QUEUE_PAGE_SIZE) ?? [];

  useEffect(() => {
    if (isSuccess && !isFetching && reports?.length === 0 && offset > 0) {
      setOffset(Math.max(0, offset - MODERATION_QUEUE_PAGE_SIZE));
    }
  }, [reports, isSuccess, isFetching, offset]);

  const act = (reportId: number, status: string) =>
    updateReport.mutate(
      { reportId, data: { status: status as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAdminReportsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          toast({ title: `Report marked ${status}` });
        },
        onError: () =>
          toast({ title: "Action failed", variant: "destructive" }),
      },
    );

  const REASON_LABELS: Record<string, string> = {
    wrong_title: "Wrong title",
    incorrect_info: "Incorrect info",
    outdated_info: "Outdated info",
    broken_source: "Broken source",
    incorrect_episode: "Wrong episode",
    other: "Other",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold">Safety Reports</h2>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !visibleReports.length ? (
        <EmptyState
          icon={AlertTriangle}
          title="No reports"
          desc={`No ${statusFilter} reports right now.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleReports.map((r) => (
            <div
              key={r.id}
              className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-bold text-foreground truncate">
                    {r.titleName}
                  </span>
                  <StatusBadge status={r.status} />
                  <span className="bg-secondary text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                    {REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                </div>
                {r.sourceName && (
                  <p className="text-sm text-muted-foreground">
                    Source:{" "}
                    <span className="font-medium text-foreground">
                      {r.sourceName}
                    </span>
                  </p>
                )}
                {r.details && (
                  <p className="text-sm text-foreground/80 italic mt-1">
                    "{r.details}"
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>
              {r.status === "open" && (
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="bg-green-600 hover:bg-green-700 text-white rounded-xl"
                    onClick={() => act(r.id, "resolved")}
                    disabled={updateReport.isPending}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => act(r.id, "dismissed")}
                    disabled={updateReport.isPending}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <AdminQueuePagination
        offset={offset}
        pageSize={MODERATION_QUEUE_PAGE_SIZE}
        resultCount={reports?.length ?? 0}
        isLoading={isLoading}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

/* ─── Feedback ─── */

export function FeedbackTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("new");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const { data: feedback, isLoading, isFetching, isSuccess } = useListAdminFeedback({
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
    limit: MODERATION_QUEUE_PAGE_SIZE + 1,
    offset,
  } as any);
  const updateFeedback = useUpdateAdminFeedback();
  const visibleFeedback = feedback?.slice(0, MODERATION_QUEUE_PAGE_SIZE) ?? [];

  useEffect(() => {
    if (isSuccess && !isFetching && feedback?.length === 0 && offset > 0) {
      setOffset(Math.max(0, offset - MODERATION_QUEUE_PAGE_SIZE));
    }
  }, [feedback, isSuccess, isFetching, offset]);

  const setStatus = (feedbackId: number, status: string) =>
    updateFeedback.mutate(
      { feedbackId, data: { status: status as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAdminFeedbackQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          toast({ title: "Feedback updated" });
        },
        onError: () =>
          toast({ title: "Action failed", variant: "destructive" }),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-display font-bold">User Feedback</h2>
        <div className="flex gap-2">
          <Select
            value={categoryFilter}
            onValueChange={(value) => {
              setCategoryFilter(value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="feature">Feature</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewing">Reviewing</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !visibleFeedback.length ? (
        <EmptyState
          icon={MessageSquare}
          title="No feedback"
          desc="No matching feedback items."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleFeedback.map((f) => (
            <div
              key={f.id}
              className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                      f.category === "bug"
                        ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                        : f.category === "feature"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {f.category}
                  </span>
                  <StatusBadge status={f.status} />
                  {f.userEmail && (
                    <span className="text-xs text-muted-foreground">
                      {f.userEmail}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground">{f.message}</p>
                {f.page && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Page: {f.page}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(f.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex-shrink-0">
                <Select
                  value={f.status}
                  onValueChange={(s) => setStatus(f.id, s)}
                  disabled={updateFeedback.isPending}
                >
                  <SelectTrigger className="w-32 text-xs h-8 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="reviewing">Reviewing</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}
      <AdminQueuePagination
        offset={offset}
        pageSize={MODERATION_QUEUE_PAGE_SIZE}
        resultCount={feedback?.length ?? 0}
        isLoading={isLoading}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

/* ─── Analytics ─── */

function AnalyticsTab() {
  const { data: analytics, isLoading } = useGetAdminAnalytics();

  if (isLoading)
    return (
      <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-3xl" />
    );
  if (!analytics)
    return (
      <EmptyState
        icon={BarChart2}
        title="No analytics data"
        desc="Analytics will populate as users visit."
      />
    );

  const maxVisitors = Math.max(
    ...(analytics.dailyVisitors?.map((d: any) => d.value) ?? [1]),
    1,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2">
            Conversion Rate
          </p>
          <p className="text-3xl font-display font-bold text-foreground">
            {analytics.conversionRatePercent?.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Visitors → Registrations (14d)
          </p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2">
            Total Visits (14d)
          </p>
          <p className="text-3xl font-display font-bold text-foreground">
            {analytics.dailyVisitors
              ?.reduce((a: number, d: any) => a + d.value, 0)
              .toLocaleString() ?? 0}
          </p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2">
            Registrations (14d)
          </p>
          <p className="text-3xl font-display font-bold text-foreground">
            {analytics.registrations
              ?.reduce((a: number, d: any) => a + d.value, 0)
              .toLocaleString() ?? 0}
          </p>
        </div>
      </div>

      {/* Daily Visitors Chart */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="text-base font-display font-bold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Daily Visitors (14d)
        </h3>
        {analytics.dailyVisitors?.length ? (
          <div className="flex items-end gap-1 h-32">
            {analytics.dailyVisitors.map((d: any) => (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-1 group relative"
              >
                <div
                  className="w-full bg-primary/20 hover:bg-primary/40 transition-colors rounded-t"
                  style={{
                    height: `${Math.max(4, (d.value / maxVisitors) * 100)}%`,
                  }}
                />
                <span className="text-[9px] text-muted-foreground rotate-45 origin-left whitespace-nowrap absolute -bottom-5">
                  {d.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No visitor data yet.</p>
        )}
      </div>

      {/* Top Lists */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TopList
          title="Top Viewed"
          icon={Eye}
          items={analytics.mostViewedTitles}
        />
        <TopList
          title="Top Searched"
          icon={Search}
          items={analytics.mostSearchedQueries}
        />
        <TopList
          title="Safety Pages"
          icon={BookOpen}
          items={analytics.mostViewedSafetyPages}
        />
        <TopList
          title="Most Tracked"
          icon={Film}
          items={analytics.mostTrackedTitles}
        />
      </div>

      {/* Device & Country */}
      <div className="grid sm:grid-cols-2 gap-4">
        <BreakdownCard title="Devices" items={analytics.deviceBreakdown} />
        <BreakdownCard title="Countries" items={analytics.countryBreakdown} />
      </div>
    </div>
  );
}

function TopList({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: any;
  items?: { name: string; count: number }[];
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h4>
      {!items?.length ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 6).map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground truncate">
                {item.name}
              </span>
              <span className="text-xs font-bold text-muted-foreground flex-shrink-0">
                {item.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownCard({
  title,
  items,
}: {
  title: string;
  items?: { name: string; count: number }[];
}) {
  const total = items?.reduce((a, i) => a + i.count, 0) ?? 0;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </h4>
      {!items?.length ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 6).map((item, i) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-foreground w-20 truncate capitalize">
                  {item.name}
                </span>
                <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-muted-foreground w-8 text-right">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Content ─── */

function ContentTab({
  ratingRegion,
  onRatingRegionChange,
  q,
  onSearchChange,
  aliasOwnership,
  onAliasOwnershipChange,
  malformedRefreshTimestamp,
  malformedRegionalClassification,
  malformedRefreshTimestampProvider,
  malformedRefreshTimestampAllRegions,
  mappingProvider,
  mappingStatus,
  onMappingProviderChange,
  onMappingStatusChange,
  onMalformedRefreshTimestampChange,
  onMalformedRegionalClassificationChange,
  onMalformedRefreshTimestampAllRegionsChange,
  contentOffset,
  onContentOffsetChange,
  reviewUrl,
  aliasId,
  aliasPage,
  aliasCursor,
  onAliasPageChange,
}: {
  ratingRegion: RatingRegion;
  onRatingRegionChange: (region: RatingRegion) => void;
  q: string;
  onSearchChange: (term: string) => void;
  aliasOwnership: AliasOwnershipFilter;
  onAliasOwnershipChange: (ownership: AliasOwnershipFilter) => void;
  malformedRefreshTimestamp: boolean;
  malformedRegionalClassification: boolean;
  malformedRefreshTimestampProvider: string;
  malformedRefreshTimestampAllRegions: boolean;
  mappingProvider: string;
  mappingStatus: MappingStatusFilter;
  onMappingProviderChange: (provider: string) => void;
  onMappingStatusChange: (status: MappingStatusFilter) => void;
  onMalformedRefreshTimestampChange: (enabled: boolean) => void;
  onMalformedRegionalClassificationChange: (enabled: boolean) => void;
  onMalformedRefreshTimestampAllRegionsChange: (enabled: boolean) => void;
  contentOffset: number;
  onContentOffsetChange: (offset: number) => void;
  reviewUrl: string;
  aliasId: number | null;
  aliasPage: number;
  aliasCursor: string | null;
  onAliasPageChange: (page: number, cursor: string | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();
  const copyReviewLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(new URL(reviewUrl, window.location.origin).href);
      toast({ title: "Review link copied" });
    } catch {
      toast({
        title: "Could not copy review link",
        description: "Copy the link from your browser address bar instead.",
        variant: "destructive",
      });
    }
  };
  const [debouncedQ, setDebouncedQ] = useState(q);
  const aliasSearchTerm = q.trim() ? debouncedQ : "";
  const contentPageSize = 50;
  const aliasPageSize = 50;
  const hasContentFilters =
    malformedRefreshTimestamp || malformedRegionalClassification ||
    Boolean(mappingProvider) || mappingStatus !== "all";
  const [batchProvider, setBatchProvider] = useState<
    "does_the_dog_die" | "wikidata"
  >("does_the_dog_die");
  const [batchLimit, setBatchLimit] = useState("10");
  const [batchOffset, setBatchOffset] = useState("0");
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [showReviewedIdentityConflicts, setShowReviewedIdentityConflicts] = useState(false);
  const [identityConflictOffset, setIdentityConflictOffset] = useState(0);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});
  const [classificationCorrections, setClassificationCorrections] =
    useState<Record<string, string>>({});

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(t);
  }, [q]);

  const contentQueryParams = {
    ...(malformedRefreshTimestampAllRegions ? {} : { region: ratingRegion }),
    ...(debouncedQ ? { q: debouncedQ } : {}),
    ...(malformedRefreshTimestamp ? { malformedRefreshTimestamp: true } : {}),
    ...(malformedRegionalClassification
      ? { malformedRegionalClassification: true }
      : {}),
    ...(malformedRefreshTimestampProvider
      ? { malformedRefreshTimestampProvider }
      : {}),
    ...(malformedRefreshTimestampAllRegions
      ? { malformedRefreshTimestampAllRegions: true }
      : {}),
    ...(mappingProvider ? { mappingProvider } : {}),
    ...(mappingStatus !== "all" ? { mappingStatus } : {}),
    ...(hasContentFilters ? { offset: contentOffset } : {}),
  };
  const {
    data: content,
    isLoading,
    isSuccess: contentSuccess,
    isError: contentError,
    isFetching: contentFetching,
    refetch: retryContent,
  } = useSearchAdminContent(contentQueryParams, {
    query: {
      queryKey: getSearchAdminContentQueryKey(contentQueryParams),
      ...(malformedRefreshTimestamp
        ? { refetchInterval: 30_000, refetchOnWindowFocus: true }
        : {}),
    },
  });
  const mappingCountsQuery = useGetAdminContentMappingCounts(
    debouncedQ ? { q: debouncedQ } : {},
  );
  const visibleContent = content?.slice(0, contentPageSize) ?? [];
  const hasNextContentPage = hasContentFilters &&
    (content?.length ?? 0) > contentPageSize;
  useEffect(() => {
    if (
      malformedRefreshTimestamp &&
      contentSuccess &&
      !contentError &&
      !contentFetching &&
      content?.length === 0 &&
      contentOffset > 0
    ) {
      onContentOffsetChange(Math.max(0, contentOffset - contentPageSize));
    }
  }, [
    content,
    contentError,
    contentFetching,
    contentOffset,
    contentSuccess,
    malformedRefreshTimestamp,
    onContentOffsetChange,
  ]);
  const {
    data: aliasesPage,
    isLoading: aliasesLoading,
    isError: aliasesError,
    error: aliasesLoadError,
    isFetching: aliasesFetching,
    refetch: retryAliases,
  } = useListAdminContentAliases({
      ...(aliasSearchTerm ? { q: aliasSearchTerm } : {}),
      ...(aliasOwnership !== "all" ? { ownership: aliasOwnership } : {}),
      limit: aliasPageSize,
      ...(aliasCursor ? { cursor: aliasCursor } : {}),
    });
  const linkedAliasQuery = useListAdminContentAliases(
    { id: aliasId ?? undefined },
    {
      query: {
        enabled: aliasId !== null,
        queryKey: getListAdminContentAliasesQueryKey({ id: aliasId ?? undefined }),
      },
    },
  );
  const linkedAlias = aliasId === null ? undefined : linkedAliasQuery.data?.items?.[0];
  const refresh = useRefreshAdminContent();
  const correctUnclassifiedRating = useCorrectAdminUnclassifiedRating();
  const dismissUnclassifiedRating = useDismissAdminUnclassifiedRating();
  const batchRefresh = useRefreshAdminContentBatch();
  const { data: batchStatus } = useGetAdminContentRefreshBatch();
  const batchHistoryQuery = useListAdminContentRefreshBatchHistory(
    { limit: 20 },
    {
      query: {
        enabled: showBatchHistory,
        queryKey: getListAdminContentRefreshBatchHistoryQueryKey({ limit: 20 }),
      },
    },
  );
  const refreshUnclassifiedReview = () => {
    void qc.invalidateQueries({ queryKey: getSearchAdminContentQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminIntegrationsQueryKey() });
  };
  const correctClassification = (
    item: ContentMapping,
    classificationIndex: number,
  ) => {
    const record = item.unclassifiedRating;
    const category = classificationCorrections[
      `${record?.recordId}-${classificationIndex}`
    ];
    if (!record || !category) return;
    correctUnclassifiedRating.mutate(
      {
        id: record.recordId,
        data: {
          expectedUpdatedAt: record.rawUpdatedAt,
          classificationIndex,
          category: category as AdminUnclassifiedRatingCorrection["category"],
        },
      },
      {
        onSuccess: () => {
          refreshUnclassifiedReview();
          toast({
            title: "Classification corrected",
            description: `${item.name} now uses the selected regional classification system.`,
          });
        },
        onError: () => toast({
          title: "Could not correct classification",
          description: "The record may have changed. Refresh the review and check it again.",
          variant: "destructive",
        }),
      },
    );
  };
  const dismissClassification = (item: ContentMapping) => {
    const record = item.unclassifiedRating;
    if (!record || !window.confirm(
      `Dismiss the unsupported rating for ${item.name}? It will not be used in regional rating results.`,
    )) return;
    dismissUnclassifiedRating.mutate(
      {
        id: record.recordId,
        data: {
          expectedUpdatedAt: record.rawUpdatedAt,
          reason: "Admin dismissed after reviewing the unsupported provider classification.",
        },
      },
      {
        onSuccess: () => {
          refreshUnclassifiedReview();
          toast({
            title: "Rating dismissed",
            description: `${item.name} was removed from rating selection.`,
          });
        },
        onError: () => toast({
          title: "Could not dismiss rating",
          description: "The record may have changed. Refresh the review and check it again.",
          variant: "destructive",
        }),
      },
    );
  };
  const identityConflictQueryParams = {
    status: showReviewedIdentityConflicts ? "all" as const : "pending" as const,
    limit: 25,
    offset: identityConflictOffset,
  };
  const identityConflictsQuery = useListAdminWikidataIdentityConflicts(
    identityConflictQueryParams,
    {
      query: {
        queryKey: getListAdminWikidataIdentityConflictsQueryKey(identityConflictQueryParams),
        staleTime: 0,
      },
    },
  );
  const reviewIdentityConflict = useReviewAdminWikidataIdentityConflict();
  const markIdentityConflictReviewed = (conflict: AdminWikidataIdentityConflict) => {
    reviewIdentityConflict.mutate(
      { titleId: conflict.titleId },
      {
        onSuccess: () => {
          if (
            !showReviewedIdentityConflicts &&
            identityConflictOffset > 0 &&
            identityConflictsQuery.data?.items.length === 1
          ) {
            setIdentityConflictOffset((offset) => Math.max(0, offset - 25));
          }
          void qc.invalidateQueries({
            queryKey: getListAdminWikidataIdentityConflictsQueryKey(),
          });
          toast({
            title: "Wikidata conflict marked reviewed",
            description: `${conflict.titleName} remains available with its existing verified mapping and safety data.`,
          });
        },
        onError: () => toast({
          title: "Could not mark conflict reviewed",
          description: "The conflict is unchanged. Try again.",
          variant: "destructive",
        }),
      },
    );
  };
  const batchResult: AdminContentRefreshBatch | null =
    batchStatus?.lastCompleted ?? null;
  const canResumeBatch =
    batchResult?.status === "completed" &&
    batchResult.processed > 0 &&
    Boolean(batchResult.catalogFingerprint) &&
    batchResult.provider === batchProvider;

  const doRefresh = (
    id: number,
    name: string,
    provider: "does_the_dog_die" | "wikidata" = "does_the_dog_die",
    reviewKey = `${id}-${ratingRegion}`,
  ) => {
    setRefreshErrors((errors) => {
      if (!errors[reviewKey]) return errors;
      const next = { ...errors };
      delete next[reviewKey];
      return next;
    });
    refresh.mutate(
      { id, data: { provider } },
      {
        onSuccess: (result) => {
          if (result.ok && malformedRefreshTimestamp) {
            const providerName = provider === "wikidata"
              ? "Wikidata"
              : "Does the Dog Die?";
            const isRepairedReviewResult = (item: ContentMapping) =>
              item.id === id &&
              item.selectedRating?.sourceName === providerName &&
              item.selectedRating.refreshTimestampMalformed;

            qc.setQueriesData<ContentMapping[]>(
              {
                queryKey: getSearchAdminContentQueryKey(),
                predicate: (query) => {
                  const params = query.queryKey[1] as {
                    malformedRefreshTimestamp?: boolean;
                    malformedRefreshTimestampProvider?: string;
                  } | undefined;
                  return params?.malformedRefreshTimestamp === true &&
                    (!params.malformedRefreshTimestampProvider ||
                      params.malformedRefreshTimestampProvider === providerName);
                },
              },
              (cached) => cached?.filter((item) => !isRepairedReviewResult(item)),
            );

            const repairedVisibleCount = visibleContent.filter(isRepairedReviewResult).length;
            if (
              repairedVisibleCount > 0 &&
              visibleContent.length === repairedVisibleCount &&
              contentOffset > 0
            ) {
              onContentOffsetChange(Math.max(0, contentOffset - contentPageSize));
            }
          }
          qc.invalidateQueries({ queryKey: getSearchAdminContentQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAdminContentMappingCountsQueryKey() });
          if (result.ok) {
            toast(result.dataStatus === "superseded"
              ? {
                  title: "Lookup succeeded; newer data retained",
                  description: `${name} was not overwritten by this older lookup.`,
                }
              : { title: `Refreshed ${name}` });
          } else {
            const message = (result as { error?: string }).error ??
              "The provider did not complete the refresh.";
            setRefreshErrors((errors) => ({ ...errors, [reviewKey]: message }));
            toast({
              title: "Refresh did not complete",
              description: message,
              variant: "destructive",
            });
          }
        },
        onError: () => {
          const message = "The refresh request failed. You can try again.";
          setRefreshErrors((errors) => ({ ...errors, [reviewKey]: message }));
          toast({ title: "Refresh failed", description: message, variant: "destructive" });
        },
      },
    );
  };

  const runBatchRefresh = (resumeRun?: AdminContentRefreshBatch) => {
    const provider = resumeRun?.provider ?? batchProvider;
    const limit = resumeRun?.limit ?? Number(batchLimit);
    const offset = resumeRun?.nextOffset ?? Number(batchOffset);
    const catalogFingerprint = resumeRun
      ? resumeRun.catalogFingerprint
      : offset > 0 && canResumeBatch
        ? batchResult?.catalogFingerprint
        : null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      toast({
        title: "Invalid batch size",
        description: "Choose a batch size from 1 to 25 titles.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isInteger(offset) || offset < 0) {
      toast({
        title: "Invalid resume offset",
        description: "The offset must be a non-negative whole number.",
        variant: "destructive",
      });
      return;
    }
    if (
      offset > 0 &&
      (resumeRun
        ? !catalogFingerprint
        : !canResumeBatch ||
          batchResult?.nextOffset !== offset ||
          batchResult?.provider !== provider ||
          !catalogFingerprint)
    ) {
      toast({
        title: "Cannot safely resume this batch",
        description:
          "Use the saved next offset for the same provider, or restart from offset 0. The catalog must remain unchanged between batches.",
        variant: "destructive",
      });
      return;
    }

    batchRefresh.mutate(
      {
        data: {
          provider,
          limit,
          offset,
          ...(offset > 0 && catalogFingerprint ? { catalogFingerprint } : {}),
        },
      },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getSearchAdminContentQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAdminContentMappingCountsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAdminContentRefreshBatchQueryKey() });
          qc.invalidateQueries({
            queryKey: getListAdminContentRefreshBatchHistoryQueryKey({ limit: 20 }),
          });
          toast({
            title: "Batch refresh complete",
            description: `Processed ${result.processed} title${result.processed === 1 ? "" : "s"} starting at offset ${result.offset}.`,
          });
        },
        onError: (error) => {
          qc.invalidateQueries({ queryKey: getGetAdminContentRefreshBatchQueryKey() });
          qc.invalidateQueries({
            queryKey: getListAdminContentRefreshBatchHistoryQueryKey({ limit: 20 }),
          });
          const responseError = (error as any)?.response?.data?.error;
          const activeBatchConflict =
            (error as any)?.response?.data?.code === "active_batch";
          toast({
            title: activeBatchConflict
              ? "Batch already running"
              : "Batch refresh failed",
            ...(typeof responseError === "string" ? { description: responseError } : {}),
            variant: "destructive",
          });
        },
      },
    );
  };

  const batchSummary = batchResult
    ? {
        mapped: batchResult.results.filter(
          (result) => result.ok && result.dataStatus !== "superseded",
        ).length,
        superseded: batchResult.results.filter(
          (result) => result.ok && result.dataStatus === "superseded",
        ).length,
        missing: batchResult.results.filter(
          (result) => !result.ok && result.status === "missing",
        ).length,
        errors: batchResult.results.filter(
          (result) =>
            !result.ok &&
            result.status !== "missing" &&
            result.dataStatus !== "superseded",
        ).length,
      }
    : null;
  const nextBatchOffset = batchResult?.nextOffset ?? null;
  const activeBatch = batchStatus?.running;
  const interruptedBatch = batchStatus?.interrupted;
  const latestKnownBatch = [batchResult, activeBatch]
    .filter((run): run is AdminContentRefreshBatch => Boolean(run))
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )[0];
  const visibleInterruptedBatch =
    interruptedBatch &&
    latestKnownBatch &&
    new Date(latestKnownBatch.startedAt).getTime() >
      new Date(interruptedBatch.startedAt).getTime()
      ? null
      : interruptedBatch;
  const canRetryInterruptedBatch = Boolean(
    visibleInterruptedBatch &&
      (visibleInterruptedBatch.nextOffset === 0 ||
        visibleInterruptedBatch.catalogFingerprint),
  );
  const isBatchRunning = batchRefresh.isPending || Boolean(activeBatch);
  const isRefreshing = refresh.isPending || isBatchRunning;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold">Content Mappings</h2>
      </div>
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-display font-bold text-foreground">
              Initial safety sync
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Refresh a bounded batch of titles from a safety provider. Requests
              are rate-limited, so run another batch with the next offset to
              resume without starting over.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="batch-provider"
                className="text-xs font-medium text-muted-foreground"
              >
                Provider
              </label>
              <Select
                value={batchProvider}
                onValueChange={(value) =>
                  setBatchProvider(value as typeof batchProvider)
                }
              >
                <SelectTrigger id="batch-provider" className="w-48 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="does_the_dog_die">
                    Does the Dog Die
                  </SelectItem>
                  <SelectItem value="wikidata">Wikidata</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="batch-limit"
                className="text-xs font-medium text-muted-foreground"
              >
                Titles per batch
              </label>
              <Input
                id="batch-limit"
                type="number"
                min={1}
                max={25}
                step={1}
                className="w-28 rounded-xl"
                value={batchLimit}
                onChange={(event) => setBatchLimit(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="batch-offset"
                className="text-xs font-medium text-muted-foreground"
              >
                Resume offset
              </label>
              <Input
                id="batch-offset"
                type="number"
                min={0}
                step={1}
                className="w-28 rounded-xl"
                value={batchOffset}
                onChange={(event) => setBatchOffset(event.target.value)}
              />
            </div>
            <Button
              className="rounded-xl gap-1.5"
              onClick={() => runBatchRefresh()}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`w-4 h-4 ${batchRefresh.isPending ? "animate-spin" : ""}`}
              />
              {isBatchRunning ? "Batch refresh running…" : "Run batch refresh"}
            </Button>
          </div>
          {isBatchRunning && (
            <div className="space-y-2 border-t border-primary/20 pt-3" role="status" aria-live="polite">
              <p className="text-sm font-semibold text-foreground">
                Batch request in progress
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
              <p className="text-xs text-muted-foreground">
                {batchRefresh.isPending
                  ? `Refreshing up to ${batchLimit} title${batchLimit === "1" ? "" : "s"} from offset ${batchOffset}.`
                  : `Refreshing up to ${activeBatch?.limit ?? batchLimit} title${(activeBatch?.limit ?? Number(batchLimit)) === 1 ? "" : "s"} from offset ${activeBatch?.offset ?? batchOffset}.`}
                {activeBatch && (
                  <>
                    {" "}
                    ·{" "}
                    {activeBatch.provider === "wikidata"
                      ? "Wikidata"
                      : "Does the Dog Die"}
                  </>
                )}
                {" "}Each title is spaced to respect provider rate limits.
              </p>
            </div>
          )}
          {visibleInterruptedBatch && (
            <div
              className="space-y-2 border-t border-orange-500/20 pt-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Batch interrupted
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {visibleInterruptedBatch.provider === "wikidata"
                      ? "Wikidata"
                      : "Does the Dog Die"}{" "}
                    · stopped before completion
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={isRefreshing || !canRetryInterruptedBatch}
                  onClick={() => {
                    setBatchProvider(visibleInterruptedBatch.provider);
                    setBatchLimit(String(visibleInterruptedBatch.limit));
                    setBatchOffset(String(visibleInterruptedBatch.nextOffset));
                    runBatchRefresh(visibleInterruptedBatch);
                  }}
                >
                  Retry interrupted batch
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Retrying will use the saved batch size of {visibleInterruptedBatch.limit}{" "}
                from offset {visibleInterruptedBatch.nextOffset}.
              </p>
              {!canRetryInterruptedBatch && (
                <p className="text-xs text-muted-foreground">
                  This interrupted run has no saved catalog snapshot. Restart from offset 0.
                </p>
              )}
            </div>
          )}
          {batchResult && batchSummary && (
            <div className="border-t border-border/60 pt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Last completed batch
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {batchResult.provider === "wikidata"
                      ? "Wikidata"
                      : "Does the Dog Die"}{" "}
                    ·{" "}
                    {new Date(
                      batchResult.completedAt ?? batchResult.startedAt,
                    ).toLocaleString()}
                  </p>
                </div>
                {batchResult.status === "failed" && (
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    Failed: {batchResult.error ?? "Unknown error"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-medium">
                  Processed {batchResult.processed} of up to {batchResult.limit}
                </span>
                <span className="text-green-600 dark:text-green-400">
                  {batchSummary.mapped} mapped
                </span>
                {batchSummary.superseded > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {batchSummary.superseded} newer data retained
                  </span>
                )}
                <span className="text-orange-600 dark:text-orange-400">
                  {batchSummary.missing} missing
                </span>
                <span className="text-red-600 dark:text-red-400">
                  {batchSummary.errors} error
                  {batchSummary.errors === 1 ? "" : "s"}
                </span>
                {batchResult.processed === 0 && (
                  <span className="text-muted-foreground">
                    No titles remain at this offset.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Next resume offset:{" "}
                  <span className="font-semibold text-foreground">
                    {nextBatchOffset}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setBatchOffset(String(nextBatchOffset))}
                >
                  Use next offset
                </Button>
              </div>
              <div className="space-y-1.5">
                {batchResult.results.map((result) => {
                  const outcome = result.ok
                    ? result.dataStatus === "superseded"
                      ? {
                          label: "Newer data retained",
                          className:
                            "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                        }
                      : {
                        label: "Mapped",
                        className:
                          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                      }
                    : result.status === "missing"
                      ? {
                          label: "Missing",
                          className:
                            "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                        }
                      : {
                          label: "Error",
                          className:
                            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                        };
                  return (
                    <div
                      key={result.titleId}
                      data-testid={`status-safety-sync-result-${result.titleId}`}
                      className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {result.titleName}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${outcome.className}`}
                      >
                        {outcome.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {result.ok && result.dataStatus === "superseded"
                          ? "Lookup succeeded; newer safety data was kept."
                          : result.ok
                          ? (result.externalId ?? "Provider mapping saved")
                          : (result.error ??
                            "Provider did not return a mapping")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Earlier safety-sync batches
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Review the 20 most recent completed or failed batches.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                aria-expanded={showBatchHistory}
                onClick={() => setShowBatchHistory((visible) => !visible)}
              >
                {showBatchHistory ? "Hide history" : "Show history"}
              </Button>
            </div>
            {showBatchHistory && (
              batchHistoryQuery.isLoading ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading batch history…
                </p>
              ) : batchHistoryQuery.isError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                    Batch history could not be loaded.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => void batchHistoryQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : batchHistoryQuery.data?.length ? (
                <div className="space-y-2">
                  {batchHistoryQuery.data.map((run: AdminContentRefreshBatchHistoryEntry) => (
                    <div
                      key={run.id}
                      className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-foreground">
                          {run.provider === "wikidata" ? "Wikidata" : "Does the Dog Die"}
                          <span className="font-normal text-muted-foreground">
                            {" "}·{" "}
                            {run.completedAt
                              ? new Date(run.completedAt).toLocaleString()
                              : "Completion time unavailable"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              run.status === "failed"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            }`}
                          >
                            {run.status === "failed" ? "Failed" : "Completed"}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2"
                            aria-label={`Download CSV report for safety-sync run ${run.id}`}
                            onClick={() => {
                              const blob = new Blob(
                                [buildSafetySyncReportCsv(run)],
                                { type: "text/csv;charset=utf-8" },
                              );
                              const url = URL.createObjectURL(blob);
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = `safety-sync-run-${run.id}.csv`;
                              document.body.appendChild(link);
                              link.click();
                              link.remove();
                              window.setTimeout(() => URL.revokeObjectURL(url), 0);
                            }}
                          >
                            <Download className="mr-1 h-3.5 w-3.5" />
                            Download CSV
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Processed {run.processed} of up to {run.limit}</span>
                        <span>{run.mapped} mapped</span>
                        {run.superseded > 0 && (
                          <span data-testid={`text-safety-sync-superseded-${run.id}`}>
                            {run.superseded} newer data retained
                          </span>
                        )}
                        <span>{run.missing} missing</span>
                        <span>{run.errors} errors</span>
                        <span>
                          Next resume offset:{" "}
                          <strong className="text-foreground">{run.nextOffset}</strong>
                        </span>
                      </div>
                      {run.error && (
                        <p className="text-xs text-red-600 dark:text-red-400">{run.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No completed or failed safety-sync batches yet.
                </p>
              )
            )}
          </div>
        </div>
      </div>
      <section
        aria-labelledby="wikidata-identity-conflicts-heading"
        className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="wikidata-identity-conflicts-heading" className="font-semibold text-foreground">
              Wikidata identity conflicts
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ambiguous entity matches stay here even after a later refresh succeeds.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              aria-pressed={showReviewedIdentityConflicts}
              onClick={() => {
                setShowReviewedIdentityConflicts((visible) => !visible);
                setIdentityConflictOffset(0);
              }}
            >
              {showReviewedIdentityConflicts ? "Hide reviewed" : "Include reviewed"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => void identityConflictsQuery.refetch()}
              disabled={identityConflictsQuery.isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${identityConflictsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh list
            </Button>
          </div>
        </div>
        {identityConflictsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading conflicts…</p>
        ) : identityConflictsQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              Wikidata identity conflicts could not be loaded.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => void identityConflictsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : identityConflictsQuery.data?.items.length ? (
          <div className="space-y-2">
            {identityConflictsQuery.data.items.map((conflict) => (
              <div
                key={conflict.id}
                className="rounded-xl border border-border/60 bg-card p-3 space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{conflict.titleName}</span>
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs uppercase text-muted-foreground">
                        {conflict.titleType}
                      </span>
                      {conflict.reviewedAt && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Reviewed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Title #{conflict.titleId}</span>
                      <a
                        className="font-medium text-primary hover:underline"
                        href={`https://www.imdb.com/title/${encodeURIComponent(conflict.imdbId)}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        IMDb {conflict.imdbId}
                      </a>
                      <span>Conflict detected {new Date(conflict.detectedAt).toLocaleString()}</span>
                      {conflict.reviewedAt && (
                        <span>Reviewed {new Date(conflict.reviewedAt).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  {!conflict.reviewedAt && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-1.5"
                      onClick={() => markIdentityConflictReviewed(conflict)}
                      disabled={reviewIdentityConflict.isPending}
                    >
                      <CheckCheck className="h-4 w-4" />
                      Mark reviewed
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{conflict.error}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <span className="font-medium text-foreground">
                    Existing verified mapping:{" "}
                    {conflict.verifiedWikidataId ? (
                      <a
                        className="text-primary hover:underline"
                        href={`https://www.wikidata.org/wiki/${encodeURIComponent(conflict.verifiedWikidataId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {conflict.verifiedWikidataId}
                      </a>
                    ) : "none"}
                  </span>
                  <span className="font-medium text-foreground">Conflicting entities:</span>
                  {conflict.conflictingEntityIds.map((entityId) => (
                    <a
                      key={entityId}
                      className="text-primary hover:underline"
                      href={`https://www.wikidata.org/wiki/${encodeURIComponent(entityId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entityId}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {(identityConflictOffset > 0 || identityConflictsQuery.data.hasMore) && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setIdentityConflictOffset(Math.max(0, identityConflictOffset - 25))}
                  disabled={identityConflictOffset === 0 || identityConflictsQuery.isFetching}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  Page {Math.floor(identityConflictOffset / 25) + 1}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setIdentityConflictOffset(identityConflictOffset + 25)}
                  disabled={!identityConflictsQuery.data.hasMore || identityConflictsQuery.isFetching}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {showReviewedIdentityConflicts
              ? "No Wikidata identity conflicts have been recorded."
              : "No Wikidata identity conflicts need review."}
          </p>
        )}
      </section>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl"
          placeholder="Search titles…"
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-mapping-provider" className="text-sm font-medium text-foreground">
            Mapping provider
          </label>
          <Input
            id="admin-mapping-provider"
            list="admin-mapping-providers"
            className="w-56 rounded-xl"
            placeholder="All providers"
            value={mappingProvider}
            onChange={(event) => onMappingProviderChange(event.target.value)}
          />
          <datalist id="admin-mapping-providers">
            <option value="TMDB" />
            <option value="Common Sense Media" />
            <option value="Does the Dog Die?" />
            <option value="Wikidata" />
            <option value="TVMaze" />
            <option value="Wikipedia" />
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-mapping-status" className="text-sm font-medium text-foreground">
            Mapping status
          </label>
          <Select
            value={mappingStatus}
            onValueChange={(value) => onMappingStatusChange(value as MappingStatusFilter)}
          >
            <SelectTrigger id="admin-mapping-status" className="w-44 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="mapped">Mapped</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <section
        aria-labelledby="admin-mapping-counts-heading"
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <h3
          id="admin-mapping-counts-heading"
          className="font-display font-bold text-foreground"
        >
          Provider link counts
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Counts include all titles matching the search, regardless of the mapping filters above.
        </p>
        {mappingCountsQuery.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Loading provider link counts…
          </p>
        ) : mappingCountsQuery.isError ? (
          <p className="mt-3 text-sm text-destructive" role="status">
            Provider link counts could not be loaded.
          </p>
        ) : mappingCountsQuery.data?.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Provider</th>
                  <th scope="col" className="py-2 px-3 font-medium">Mapped</th>
                  <th scope="col" className="py-2 px-3 font-medium">Missing</th>
                  <th scope="col" className="py-2 pl-3 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {mappingCountsQuery.data.map((counts) => (
                  <tr key={counts.provider} className="border-b last:border-0 border-border">
                    <th scope="row" className="py-2 pr-4 font-medium text-foreground">
                      {counts.provider}
                    </th>
                    <td className="py-2 px-3 tabular-nums">{counts.mapped}</td>
                    <td className="py-2 px-3 tabular-nums">{counts.missing}</td>
                    <td className="py-2 pl-3 tabular-nums">{counts.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No provider links match this title search.
          </p>
        )}
      </section>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor="admin-rating-region"
          className="text-sm font-medium text-foreground"
        >
          Review Wikidata region
        </label>
        <Select
          value={ratingRegion}
          onValueChange={(value: RatingRegion) => onRatingRegionChange(value)}
          disabled={malformedRefreshTimestampAllRegions || malformedRegionalClassification}
        >
          <SelectTrigger
            id="admin-rating-region"
            className="w-56 rounded-xl"
            aria-label="Review Wikidata region"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RATING_REGIONS.map((region) => (
              <SelectItem key={region.code} value={region.code}>
                {region.code} · {region.countryName} ({region.system})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {malformedRegionalClassification
            ? `Malformed records without supported classifications${malformedRefreshTimestampProvider ? ` · ${malformedRefreshTimestampProvider}` : ""}; these are kept separate from regional results.`
            : malformedRefreshTimestampAllRegions
            ? "Includes every supported region; records without a supported regional classification are not listed."
            : "Titles below use the selected official classification."}
        </span>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={malformedRefreshTimestamp && !malformedRegionalClassification}
            onCheckedChange={(checked) => onMalformedRefreshTimestampChange(checked === true)}
            disabled={malformedRegionalClassification}
            aria-label="Only ratings with malformed refresh timestamps"
          />
          Only ratings with malformed refresh timestamps
        </label>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={malformedRegionalClassification}
            onCheckedChange={(checked) =>
              onMalformedRegionalClassificationChange(checked === true)
            }
            aria-label="Only malformed records without a supported regional classification"
          />
          Unclassified malformed records
        </label>
        {malformedRefreshTimestamp && (
          <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <Checkbox
              checked={malformedRefreshTimestampAllRegions}
              onCheckedChange={(checked) =>
                onMalformedRefreshTimestampAllRegionsChange(checked === true)
              }
              disabled={!malformedRefreshTimestampProvider}
              aria-label="Review malformed ratings across all regions"
            />
            Across all regions
            {malformedRefreshTimestampAllRegions && malformedRefreshTimestampProvider
              ? ` · ${malformedRefreshTimestampProvider}`
              : ""}
          </label>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5"
          onClick={() => void copyReviewLink()}
        >
          <Link2 className="w-4 h-4" /> Copy review link
        </Button>
      </div>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : contentError && !content ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-medium text-foreground">
            Could not load titles for {malformedRegionalClassification
              ? `unclassified ratings${malformedRefreshTimestampProvider ? ` from ${malformedRefreshTimestampProvider}` : ""}`
              : malformedRefreshTimestampAllRegions
              ? `all regions (${malformedRefreshTimestampProvider})`
              : ratingRegion}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The content request failed. Try again to review these titles.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 rounded-xl"
            onClick={() => void retryContent()}
            disabled={contentFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {contentFetching
              ? "Retrying…"
              : `Retry ${malformedRegionalClassification
                ? "unclassified ratings"
                : malformedRefreshTimestampAllRegions
                  ? "all-region"
                  : ratingRegion} titles`}
          </Button>
        </div>
      ) : !content?.length ? (
        <EmptyState
          icon={Database}
          title="No titles found"
          desc="Try a different search term or adjust the filters."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {contentError && (
            <div
              role="status"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground"
            >
              The latest refresh failed. Showing the last successfully loaded
              results while trying again.
            </div>
          )}
          {visibleContent.map((item) => (
            <div
              key={`${item.id}-${item.unclassifiedRating?.recordId ?? item.selectedRating?.region ?? ratingRegion}`}
              className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                {refreshErrors[`${item.id}-${item.selectedRating?.region ?? ratingRegion}`] ? (
                  <p
                    className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid={`status-rating-refresh-failure-${item.id}-${item.selectedRating?.region ?? ratingRegion}`}
                  >
                    Refresh failed for {item.selectedRating?.region ?? ratingRegion}:{" "}
                    {refreshErrors[`${item.id}-${item.selectedRating?.region ?? ratingRegion}`]}
                  </p>
                ) : null}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold text-foreground">{item.name}</span>
                  <span className="px-2 py-0.5 rounded bg-secondary text-muted-foreground text-xs uppercase">
                    {item.type}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {item.mappings?.map((m: any) => (
                    <div
                      key={m.provider}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${m.status === "mapped" ? "bg-green-500" : m.status === "error" ? "bg-red-500" : "bg-muted-foreground/40"}`}
                      />
                      <span className="text-muted-foreground">
                        {m.provider}
                      </span>
                      <span
                        className={`font-medium ${m.status === "mapped" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                      >
                        {m.externalId ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {item.selectedRating?.classificationCorrection ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Admin correction: provider category{" "}
                    {item.selectedRating?.classificationCorrection?.providerCategory ?? "(missing)"}{" "}
                    → {item.selectedRating?.classificationCorrection?.correctedCategory} · admin{" "}
                    {item.selectedRating?.classificationCorrection?.adminId} ·{" "}
                    {new Date(item.selectedRating?.classificationCorrection?.correctedAt ?? "").toLocaleString()}
                  </p>
                ) : null}
                <div className="mt-3 rounded-xl bg-secondary/40 px-3 py-2 text-xs">
                  {item.unclassifiedRating ? (
                    <>
                      <span className="font-semibold text-foreground">
                        Unclassified {item.unclassifiedRating.provider} rating · safety record #
                        {item.unclassifiedRating.recordId}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}· raw timestamp: {item.unclassifiedRating.rawUpdatedAt}
                      </span>
                      {item.unclassifiedRating.classifications.length ? (
                        <div className="mt-2 space-y-2">
                          {item.unclassifiedRating.classifications.map((classification, index) => {
                            const correctionKey =
                              `${item.unclassifiedRating!.recordId}-${index}`;
                            return (
                              <div
                                key={`${classification.category ?? "missing"}-${index}`}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <span className="min-w-0 flex-1 text-muted-foreground">
                                  {classification.category ?? "(missing category)"}
                                  {classification.label ? `: ${classification.label}` : ""}
                                  {classification.score !== null || classification.maxScore !== null
                                    ? ` · score ${classification.score ?? "?"}/${classification.maxScore ?? "?"}`
                                    : ""}
                                  {classification.severity ? ` · ${classification.severity}` : ""}
                                  {classification.description ? ` · ${classification.description}` : ""}
                                </span>
                                <Select
                                  value={classificationCorrections[correctionKey] ?? ""}
                                  onValueChange={(category) =>
                                    setClassificationCorrections((previous) => ({
                                      ...previous,
                                      [correctionKey]: category,
                                    }))
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8 w-48 rounded-lg bg-background"
                                    aria-label={`Correct category for ${item.name} classification ${index + 1}`}
                                  >
                                    <SelectValue placeholder="Choose rating system" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[...new Set(RATING_REGIONS.map(({ system }) => system))].map(
                                      (system) => (
                                        <SelectItem key={system} value={system}>
                                          {system}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-lg"
                                  disabled={
                                    !classificationCorrections[correctionKey] ||
                                    correctUnclassifiedRating.isPending ||
                                    dismissUnclassifiedRating.isPending
                                  }
                                  onClick={() => correctClassification(item, index)}
                                >
                                  Correct category
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-muted-foreground">
                          No classification items are available to correct.
                        </p>
                      )}
                      {item.unclassifiedRating.sourceUrl ? (
                        <a
                          className="mt-2 inline-block font-medium text-primary hover:underline"
                          href={item.unclassifiedRating.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View provider record
                        </a>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-lg"
                          disabled={
                            correctUnclassifiedRating.isPending ||
                            dismissUnclassifiedRating.isPending
                          }
                          onClick={() => dismissClassification(item)}
                        >
                          Dismiss rating
                        </Button>
                      </div>
                    </>
                  ) : item.selectedRating ? (
                    <>
                      <span className="font-semibold text-foreground">
                        Selected {item.selectedRating.region}{" "}
                        {item.selectedRating.sourceName} rating:
                      </span>{" "}
                      <span className="font-medium text-foreground">
                        {item.selectedRating.label}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}· {item.selectedRating.region} · {item.selectedRating.countryName} ·{" "}
                        {item.selectedRating.system} ·{" "}
                        {item.selectedRating.sourceName} · safety record #
                        {item.selectedRating.recordId ?? "unknown"} · refreshed{" "}
                        {item.selectedRating.lastRefreshedAt
                          ? new Date(item.selectedRating.lastRefreshedAt).toLocaleString()
                          : "unknown"}
                      </span>
                      {item.selectedRating.refreshTimestampMalformed ? (
                        <span
                          className="ml-2 font-semibold text-amber-700 dark:text-amber-300"
                          role="status"
                          data-testid={`status-rating-refresh-warning-${item.id}`}
                        >
                          Refresh timestamp is malformed; check this provider record.
                        </span>
                      ) : null}
                      {item.selectedRating.hasLatestRatingLabelConflict === true ? (
                        <span
                          className="ml-2 font-semibold text-amber-700 dark:text-amber-300"
                          role="status"
                          data-testid={`status-rating-label-conflict-${item.id}`}
                        >
                          Conflicting official ratings for {item.selectedRating.region}{" "}
                          ({item.selectedRating.system}) share the latest refresh time.
                        </span>
                      ) : null}
                      {item.selectedRating.sourceUrl ? (
                        <a
                          className="ml-2 font-medium text-primary hover:underline"
                          href={item.selectedRating.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View Wikidata record
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">
                        Selected {ratingRegion} Wikidata rating:
                      </span>{" "}
                      <span className="text-muted-foreground">
                        No available {ratingRegion} Wikidata classification
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl gap-1.5"
                  onClick={() =>
                    doRefresh(
                      item.id,
                      item.name,
                      "does_the_dog_die",
                      `${item.id}-${item.selectedRating?.region ?? ratingRegion}`,
                    )
                  }
                  disabled={isRefreshing}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh DDD
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl gap-1.5"
                  onClick={() =>
                    doRefresh(
                      item.id,
                      item.name,
                      "wikidata",
                      `${item.id}-${item.selectedRating?.region ?? ratingRegion}`,
                    )
                  }
                  disabled={isRefreshing}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Wikidata
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {hasContentFilters && (
        <div
          className="mt-4 flex items-center justify-center gap-3"
          aria-label="Filtered content results pagination"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => onContentOffsetChange(Math.max(0, contentOffset - contentPageSize))}
            disabled={contentOffset === 0 || contentFetching}
          >
            <ChevronLeft className="w-4 h-4" /> Previous page
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            Page {Math.floor(contentOffset / contentPageSize) + 1}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => onContentOffsetChange(contentOffset + contentPageSize)}
            disabled={!hasNextContentPage || contentFetching}
          >
            Next page <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
      <AliasReview
        aliases={aliasesPage?.items}
        q={aliasSearchTerm}
        searchTerm={q}
        searchPending={q.trim() !== debouncedQ.trim()}
        getToken={getToken}
        aliasTotal={aliasesPage?.total}
        aliasPage={aliasPage}
        currentAliasCursor={aliasCursor}
        nextAliasCursor={aliasesPage?.nextCursor}
        previousAliasCursor={aliasesPage?.previousCursor}
        onAliasPageChange={onAliasPageChange}
        hasAliasCursor={aliasCursor !== null}
        isLoading={aliasesLoading}
        isError={aliasesError}
        loadError={aliasesLoadError}
        isFetching={aliasesFetching}
        onRetry={() => void retryAliases()}
        ownership={aliasOwnership}
        onOwnershipChange={onAliasOwnershipChange}
        reviewUrl={reviewUrl}
        linkedAliasId={aliasId}
        linkedAlias={linkedAlias}
        linkedAliasLoading={linkedAliasQuery.isLoading}
        linkedAliasError={linkedAliasQuery.isError}
        onRetryLinkedAlias={() => void linkedAliasQuery.refetch()}
      />
    </div>
  );
}

function getAliasReviewLoadExplanation(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("data" in error)) return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;

  switch ((data as { error?: unknown }).error) {
    case "This alias review matches more than 10,000 aliases. Narrow your search and try again.":
      return "This review exceeds the 10,000-alias limit. Narrow your search and try again.";
    case "Invalid alias snapshot cursor":
    case "Invalid alias snapshot offset":
      return "The saved page link is invalid, so this review cannot resume. Restart the review to load page 1.";
    case "Alias snapshot cursor does not match the active filters":
      return "The saved page was created with different search or ownership filters. Restart the review to load page 1 with the current filters.";
    case "This alias review snapshot expired. Restart the search.":
      return "The saved review's result snapshot changed or expired. Restart the review to load current results.";
    default:
      return undefined;
  }
}

export function AliasReview({
  aliases,
  q = "",
  searchTerm = q,
  searchPending = false,
  getToken = async () => null,
  aliasTotal = aliases?.length ?? 0,
  aliasPage = 1,
  currentAliasCursor = null,
  nextAliasCursor,
  previousAliasCursor,
  onAliasPageChange = () => {},
  hasAliasCursor = false,
  isLoading,
  isError,
  loadError,
  isFetching,
  onRetry,
  ownership,
  onOwnershipChange,
  reviewUrl,
  linkedAliasId = null,
  linkedAlias,
  linkedAliasLoading = false,
  linkedAliasError = false,
  onRetryLinkedAlias,
}: {
  aliases: AdminContentAlias[] | undefined;
  q?: string;
  searchTerm?: string;
  searchPending?: boolean;
  getToken?: () => Promise<string | null>;
  aliasTotal?: number;
  aliasPage?: number;
  currentAliasCursor?: string | null;
  nextAliasCursor?: string | null;
  previousAliasCursor?: string | null;
  onAliasPageChange?: (page: number, cursor: string | null) => void;
  hasAliasCursor?: boolean;
  isLoading: boolean;
  isError: boolean;
  loadError?: unknown;
  isFetching: boolean;
  onRetry: () => void;
  ownership: ListAdminContentAliasesOwnership | "all";
  onOwnershipChange: (
    ownership: ListAdminContentAliasesOwnership | "all",
  ) => void;
  reviewUrl?: string;
  linkedAliasId?: number | null;
  linkedAlias?: AdminContentAlias;
  linkedAliasLoading?: boolean;
  linkedAliasError?: boolean;
  onRetryLinkedAlias?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const linkedRowRef = React.useRef<HTMLTableRowElement>(null);
  const aliasLoadAlertRef = React.useRef<HTMLDivElement>(null);
  const loadExplanation = getAliasReviewLoadExplanation(loadError);
  const aliasLoadAlertTitleId = React.useId();
  const aliasLoadAlertDescriptionId = React.useId();
  React.useEffect(() => {
    if (loadExplanation) {
      aliasLoadAlertRef.current?.focus();
    }
  }, [loadExplanation]);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingPreviousAliasPage, setPendingPreviousAliasPage] = useState<{
    page: number;
    cursor: string | null;
    q: string;
    ownership: ListAdminContentAliasesOwnership | "all";
  } | null>(null);
  const [savedAliasPreviewStates, setSavedAliasPreviewStates] = useState<
    {
      alias: AdminContentAlias;
      q: string;
      ownership: ListAdminContentAliasesOwnership | "all";
      refreshed: boolean;
    }[]
  >([]);
  const currentSavedAliasPreviewStates = savedAliasPreviewStates.filter(
    (preview) => preview.q === q.trim() && preview.ownership === ownership,
  );
  const savedAliasPreviews = currentSavedAliasPreviewStates.map(
    (preview) => preview.alias,
  );
  const getSavedAliasPreviewState = (id: number) =>
    currentSavedAliasPreviewStates.find((preview) => preview.alias.id === id);
  const getSavedAliasPreview = (id: number) =>
    getSavedAliasPreviewState(id)?.alias ?? null;
  const isSavedAliasPreviewUnrefreshed = (id: number) =>
    getSavedAliasPreviewState(id)?.refreshed === false;
  React.useEffect(() => {
    setSavedAliasPreviewStates((current) => {
      const next = current.filter(
        (preview) =>
          preview.q === q.trim() &&
          preview.ownership === ownership &&
          !(
            preview.refreshed &&
            aliases?.some((alias) => alias.id === preview.alias.id)
          ),
      );
      return next.length === current.length ? current : next;
    });
  }, [q, ownership, aliases]);
  const [removedAliasPreviews, setRemovedAliasPreviews] = useState<
    AdminContentAlias[]
  >([]);
  React.useEffect(() => {
    if (linkedAlias) linkedRowRef.current?.scrollIntoView?.({ block: "center" });
  }, [linkedAlias?.id]);
  const removedAliasIds = new Set(
    removedAliasPreviews.map((alias) => alias.id),
  );
  const aliasesWithSavedPreview = aliases?.map((alias) => {
    const savedPreview = getSavedAliasPreviewState(alias.id);
    return savedPreview && !savedPreview.refreshed ? savedPreview.alias : alias;
  });
  const savedPreviewsOutsidePage = savedAliasPreviews.filter(
    (savedPreview) => !aliases?.some((alias) => alias.id === savedPreview.id),
  );
  const reviewAliases = aliasesWithSavedPreview
    ? [...savedPreviewsOutsidePage, ...aliasesWithSavedPreview]
    : savedAliasPreviews.length > 0
      ? savedAliasPreviews
      : undefined;
  const visibleAliasesBeforeRemoval =
    linkedAlias && !reviewAliases?.some((alias) => alias.id === linkedAlias.id)
      ? [linkedAlias, ...(reviewAliases ?? [])]
      : reviewAliases;
  const visibleAliases = visibleAliasesBeforeRemoval?.filter(
    (alias) => !removedAliasIds.has(alias.id),
  );
  const visibleAliasTotal = Math.max(
    0,
    aliasTotal -
      (aliases?.filter((alias) => removedAliasIds.has(alias.id)).length ?? 0),
  );
  const collisionLookupAliases = Array.from(
    new Set(visibleAliases?.map((alias) => alias.alias) ?? []),
  );
  const copyAliasLink = async (alias: AdminContentAlias) => {
    if (!reviewUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      const url = new URL(reviewUrl, window.location.origin);
      url.searchParams.set("aliasId", String(alias.id));
      await navigator.clipboard.writeText(url.href);
      toast({ title: "Alternate title link copied" });
    } catch {
      toast({
        title: "Could not copy alternate title link",
        description: "Allow clipboard access and try again.",
        variant: "destructive",
      });
    }
  };
  const exportAliases = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (ownership !== "all") params.set("ownership", ownership);
      const query = params.size ? `?${params.toString()}` : "";
      const response = await fetch(`/api/admin/content-aliases/export${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        let description = "The server could not create the export. Try again.";
        try {
          const body = await response.json() as { error?: unknown };
          if (typeof body.error === "string") description = body.error;
        } catch {
          // Keep the actionable default when the response is not JSON.
        }
        toast({
          title: "Could not export alternate titles",
          description,
          variant: "destructive",
        });
        return;
      }
      const count = Number(response.headers.get("X-Export-Count") ?? "0");
      if (count === 0) {
        toast({
          title: "No alternate titles to export",
          description: "No aliases match the current search and ownership filters.",
        });
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1];
      link.href = url;
      link.download = filename ?? `alternate-title-review-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({
        title: "Alternate titles exported",
        description: `${count} aliases downloaded.`,
      });
    } catch {
      toast({
        title: "Could not export alternate titles",
        description: "The export request failed. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };
  const updateAlias = useUpdateAdminContentAlias();
  const deleteAlias = useDeleteAdminContentAlias();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    alias: "",
    language: "",
    sourceUrl: "",
    expectedUpdatedAt: "",
  });
  const previousAliasEditContext = React.useRef({
    searchTerm: searchTerm.trim(),
    ownership,
  });
  React.useEffect(() => {
    const nextContext = { searchTerm: searchTerm.trim(), ownership };
    const previousContext = previousAliasEditContext.current;
    if (
      previousContext.searchTerm === nextContext.searchTerm &&
      previousContext.ownership === nextContext.ownership
    ) {
      return;
    }
    previousAliasEditContext.current = nextContext;
    setEditingId(null);
    setDraft({
      alias: "",
      language: "",
      sourceUrl: "",
      expectedUpdatedAt: "",
    });
  }, [searchTerm, ownership]);
  const [conflictAlias, setConflictAlias] = useState<AdminContentAlias | null>(
    null,
  );
  const [isConflictCorrectionStale, setIsConflictCorrectionStale] =
    useState(false);
  const [collisionCountOverrides, setCollisionCountOverrides] = useState<
    Map<string, AdminContentAliasCollisionCount>
  >(() => new Map());
  React.useEffect(() => {
    setCollisionCountOverrides((current) =>
      current.size > 0 ? new Map() : current,
    );
  }, [aliases]);
  const aliasesWithCurrentCollisionCounts = visibleAliases?.map((alias) => {
    const collisionCount = collisionCountOverrides.get(alias.alias);
    return collisionCount
      ? {
          ...alias,
          collision: collisionCount.collision,
          collisionTitleCount: collisionCount.collisionTitleCount,
        }
      : alias;
  });
  const hasPendingPreviousAliasPage =
    isFetching &&
    aliases === undefined &&
    pendingPreviousAliasPage?.page === aliasPage &&
    pendingPreviousAliasPage.q === q.trim() &&
    pendingPreviousAliasPage.ownership === ownership;
  const canNavigateToPreviousAliasPage =
    previousAliasCursor != null || hasPendingPreviousAliasPage;
  type ReviewRefreshRequest = "aliases" | "catalog" | "collisions";
  const [refreshError, setRefreshError] = useState<
    ReviewRefreshRequest[] | null
  >(null);
  const [isCollisionResultsStale, setIsCollisionResultsStale] = useState(false);
  const [isRefreshingAliasViews, setIsRefreshingAliasViews] = useState(false);
  const [isAliasRefreshTimedOut, setIsAliasRefreshTimedOut] = useState(false);
  const aliasRefreshAttempt = useRef(0);
  const previousAliasReviewFilters = useRef({
    q: q.trim(),
    ownership,
  });
  React.useEffect(() => {
    const nextFilters = { q: q.trim(), ownership };
    const previousFilters = previousAliasReviewFilters.current;
    if (
      previousFilters.q === nextFilters.q &&
      previousFilters.ownership === nextFilters.ownership
    ) {
      return;
    }
    previousAliasReviewFilters.current = nextFilters;
    aliasRefreshAttempt.current += 1;
    setRefreshError(null);
    setIsCollisionResultsStale(false);
    setIsAliasRefreshTimedOut(false);
    setIsRefreshingAliasViews(false);
  }, [q, ownership]);

  const formatRefreshFailures = (failedRequests: ReviewRefreshRequest[]) => {
    const requestNames = failedRequests.map((request) =>
      request === "aliases"
        ? "alternate-title list (alias records)"
        : request === "catalog"
          ? "catalog search (collision results)"
          : "alternate-title collision counts",
    );
    return `Failed refresh ${
      requestNames.length === 1 ? "request" : "requests"
    }: ${requestNames.join(" and ")}.`;
  };

  const describeRefreshStaleness = (
    failedRequests: ReviewRefreshRequest[],
  ) => {
    const aliasesFailed = failedRequests.includes("aliases");
    const collisionResultsFailed =
      failedRequests.includes("catalog") ||
      failedRequests.includes("collisions");
    if (aliasesFailed && collisionResultsFailed) {
      return "The alternate-title list and collision results may be stale.";
    }
    if (aliasesFailed) {
      return "The alternate-title list may be stale; collision results refreshed successfully.";
    }
    return "Collision results may be stale; the alternate-title list refreshed successfully.";
  };

  const refreshAliasViews = async (
    requests: ReviewRefreshRequest[] = ["aliases", "catalog", "collisions"],
    aliasesForCollisionLookup: string[] = collisionLookupAliases,
  ): Promise<ReviewRefreshRequest[] | null> => {
    const attempt = ++aliasRefreshAttempt.current;
    const pendingRequests = new Set(requests);
    const settledFailures = new Set<ReviewRefreshRequest>();
    setIsAliasRefreshTimedOut(false);
    setIsRefreshingAliasViews(true);
    if (requests.includes("catalog") || requests.includes("collisions")) {
      setIsCollisionResultsStale(true);
    }
    const recoveryTimer = window.setTimeout(() => {
      if (aliasRefreshAttempt.current !== attempt) return;
      const timedOutRequests = Array.from(
        new Set([...settledFailures, ...pendingRequests]),
      );
      if (timedOutRequests.length === 0) return;
      setIsAliasRefreshTimedOut(true);
      setRefreshError(timedOutRequests);
      if (timedOutRequests.includes("aliases")) {
        setIsConflictCorrectionStale(true);
      }
      setIsCollisionResultsStale(
        timedOutRequests.includes("catalog") ||
          timedOutRequests.includes("collisions"),
      );
      setIsRefreshingAliasViews(false);
    }, ALIAS_REFRESH_RECOVERY_TIMEOUT_MS);
    try {
      const results = await Promise.allSettled(
        requests.map(async (request) => {
          try {
            const result = await Promise.resolve().then(async () => {
              if (request === "collisions") {
                return aliasesForCollisionLookup.length === 0
                  ? []
                  : await lookupAdminContentAliasCollisions({
                      aliases: aliasesForCollisionLookup,
                    });
              }
              return await qc.invalidateQueries(
                {
                  queryKey:
                    request === "aliases"
                      ? getListAdminContentAliasesQueryKey()
                      : getSearchAdminContentQueryKey(),
                },
                { throwOnError: true },
              );
            });
            if (
              request === "aliases" &&
              aliasRefreshAttempt.current === attempt
            ) {
              setIsConflictCorrectionStale(false);
            }
            return result;
          } catch (error) {
            settledFailures.add(request);
            if (
              request === "aliases" &&
              aliasRefreshAttempt.current === attempt
            ) {
              setIsConflictCorrectionStale(true);
            }
            throw error;
          } finally {
            pendingRequests.delete(request);
          }
        }),
      );
      const failedRequests = requests.filter(
        (_request, index) => results[index].status === "rejected",
      );
      if (aliasRefreshAttempt.current !== attempt) return null;
      setRefreshError(failedRequests.length > 0 ? failedRequests : null);
      const collisionRequestIndex = requests.indexOf("collisions");
      if (collisionRequestIndex >= 0) {
        const collisionResult = results[collisionRequestIndex];
        if (
          collisionResult.status === "fulfilled" &&
          Array.isArray(collisionResult.value)
        ) {
          setCollisionCountOverrides(
            new Map(
              collisionResult.value.map((entry) => [entry.alias, entry]),
            ),
          );
        }
      }
      if (requests.includes("catalog") || requests.includes("collisions")) {
        setIsCollisionResultsStale(
          failedRequests.includes("catalog") ||
            failedRequests.includes("collisions"),
        );
      }
      setIsAliasRefreshTimedOut(false);
      if (
        requests.includes("aliases") &&
        !failedRequests.includes("aliases")
      ) {
        setSavedAliasPreviewStates((current) =>
          current.map((preview) =>
            preview.q === q.trim() && preview.ownership === ownership
              ? { ...preview, refreshed: true }
              : preview,
          ),
        );
        setRemovedAliasPreviews([]);
      }
      return failedRequests;
    } finally {
      window.clearTimeout(recoveryTimer);
      if (aliasRefreshAttempt.current === attempt) {
        setIsRefreshingAliasViews(false);
      }
    }
  };

  const errorDescription = (error: unknown) => {
    if (error && typeof error === "object" && "data" in error) {
      const data = (error as { data?: unknown }).data;
      if (data && typeof data === "object" && "error" in data) {
        const message = (data as { error?: unknown }).error;
        if (typeof message === "string") return message;
      }
    }
    return error instanceof Error ? error.message : "Please try again.";
  };

  const getEditingAlias = () => {
    if (editingId === null) return null;
    if (conflictAlias?.id === editingId) return conflictAlias;
    const savedPreview = getSavedAliasPreview(editingId);
    if (savedPreview) return savedPreview;
    return aliases?.find((candidate) => candidate.id === editingId) ?? null;
  };

  const cancelEditing = () => {
    const alias = getEditingAlias();
    if (alias) {
      setDraft({
        alias: alias.alias,
        language: alias.language ?? "",
        sourceUrl: alias.sourceUrl ?? "",
        expectedUpdatedAt: alias.updatedAt,
      });
    }
    setEditingId(null);
  };

  const hasUnsavedAliasChanges = () => {
    if (editingId === null) return false;
    const current = getEditingAlias();
    if (!current) return true;
    return (
      draft.alias !== current.alias ||
      draft.language !== (current.language ?? "") ||
      draft.sourceUrl !== (current.sourceUrl ?? "")
    );
  };

  const startEditing = (alias: AdminContentAlias) => {
    if (editingId !== null && editingId !== alias.id && hasUnsavedAliasChanges()) {
      const current = getEditingAlias();
      if (
        !window.confirm(
          `Discard your unsaved changes to “${current?.alias ?? "this alternate title"}” and edit “${alias.alias}” instead?`,
        )
      ) {
        return;
      }
    }
    setEditingId(alias.id);
    setDraft({
      alias: alias.alias,
      language: alias.language ?? "",
      sourceUrl: alias.sourceUrl ?? "",
      expectedUpdatedAt: alias.updatedAt,
    });
  };

  const startEditingConflict = () => {
    if (!conflictAlias) return;
    setEditingId(conflictAlias.id);
    setDraft({
      alias: conflictAlias.alias,
      language: conflictAlias.language ?? "",
      sourceUrl: conflictAlias.sourceUrl ?? "",
      expectedUpdatedAt: conflictAlias.updatedAt,
    });
  };

  const saveAlias = () => {
    if (editingId === null) return;
    const alias = draft.alias.trim();
    if (!alias) {
      toast({
        title: "Alias is required",
        description: "Enter an alternate title before saving.",
        variant: "destructive",
      });
      return;
    }
    const editedAlias =
      conflictAlias?.id === editingId
        ? conflictAlias
        : getSavedAliasPreview(editingId)
          ? getSavedAliasPreview(editingId)
          : aliases?.find((candidate) => candidate.id === editingId) ?? null;
    updateAlias.mutate(
      {
        id: editingId,
        data: {
          alias,
          language: draft.language.trim() || null,
          sourceUrl: draft.sourceUrl.trim() || null,
          expectedUpdatedAt: draft.expectedUpdatedAt,
        },
      },
      {
        onSuccess: async (savedRecord?: AdminContentAliasRecord) => {
          setEditingId(null);
          setConflictAlias((current) =>
            current?.id === editingId ? null : current,
          );
          setIsConflictCorrectionStale(false);
          const savedAlias = savedRecord?.alias ?? alias;
          const aliasesForCollisionLookup = Array.from(
            new Set(
              (visibleAliases ?? []).map((visibleAlias) =>
                visibleAlias.id === editingId
                  ? savedAlias
                  : visibleAlias.alias,
              ),
            ),
          );
          if (!aliasesForCollisionLookup.includes(savedAlias)) {
            aliasesForCollisionLookup.push(savedAlias);
          }
          if (editedAlias) {
            const savedPreview = {
              alias: {
                ...editedAlias,
                alias: savedAlias,
                language:
                  savedRecord?.language ?? (draft.language.trim() || null),
                sourceName: savedRecord?.sourceName ?? editedAlias.sourceName,
                sourceUrl:
                  savedRecord?.sourceUrl ?? (draft.sourceUrl.trim() || null),
                isEditorial:
                  savedRecord?.isEditorial ?? editedAlias.isEditorial,
                updatedAt: savedRecord?.updatedAt ?? editedAlias.updatedAt,
              },
              q: q.trim(),
              ownership,
              refreshed: false,
            };
            setSavedAliasPreviewStates((current) => {
              const existingIndex = current.findIndex(
                (preview) => preview.alias.id === editingId,
              );
              return existingIndex === -1
                ? [...current, savedPreview]
                : current.map((preview, index) =>
                    index === existingIndex ? savedPreview : preview,
                  );
            });
          }
          const failedRequests = await refreshAliasViews(
            undefined,
            aliasesForCollisionLookup,
          );
          if (!failedRequests) return;
          toast(
            failedRequests.length === 0
              ? { title: "Alternate title updated" }
              : {
                  title: "Alternate title updated, but refresh failed",
                  description: `${describeRefreshStaleness(failedRequests)} ${formatRefreshFailures(failedRequests)} Retry the refresh below.`,
                  variant: "destructive",
                },
          );
        },
        onError: async (error) => {
          const description = errorDescription(error);
          const data =
            error && typeof error === "object" && "data" in error
              ? (error as { data?: unknown }).data
              : null;
          const staleConflict =
            data &&
            typeof data === "object" &&
            "code" in data &&
            data.code === "stale_alias" &&
            "current" in data &&
            data.current &&
            typeof data.current === "object"
              ? (data.current as AdminContentAlias)
              : null;
          if (staleConflict) {
            setConflictAlias(staleConflict);
            setIsConflictCorrectionStale(false);
            setEditingId(null);
            await refreshAliasViews();
          }
          toast({
            title: "Could not update alternate title",
            description: staleConflict
              ? "Your draft was not saved. Review the newer correction below before trying again."
              : description,
            variant: "destructive",
          });
        },
      },
    );
  };

  const removeAlias = (alias: AdminContentAlias) => {
    const discardsUnsavedChanges =
      editingId === alias.id && hasUnsavedAliasChanges();
    if (
      !window.confirm(
        discardsUnsavedChanges
          ? `Remove “${alias.alias}” from ${alias.titleName}? This will also discard your unsaved changes. This cannot be undone.`
          : `Remove “${alias.alias}” from ${alias.titleName}? This cannot be undone.`,
      )
    ) {
      return;
    }
    deleteAlias.mutate(
      {
        id: alias.id,
        data: { expectedUpdatedAt: alias.updatedAt },
      },
      {
        onSuccess: async () => {
          qc.setQueriesData<AdminContentAliasPage>(
            { queryKey: getListAdminContentAliasesQueryKey() },
            (current) => {
              if (!current?.items.some((item) => item.id === alias.id)) {
                return current;
              }
              return {
                ...current,
                items: current.items.filter((item) => item.id !== alias.id),
                total: Math.max(0, current.total - 1),
              };
            },
          );
          // Cursor pages use a fixed snapshot. Start a fresh one so its total
          // and navigation reflect the deletion instead of the old snapshot.
          onAliasPageChange(1, null);
          if (editingId === alias.id) setEditingId(null);
          setRemovedAliasPreviews((current) =>
            current.some((removedAlias) => removedAlias.id === alias.id)
              ? current
              : [...current, alias],
          );
          setSavedAliasPreviewStates((current) =>
            current.filter((preview) => preview.alias.id !== alias.id),
          );
          setConflictAlias((current) =>
            current?.id === alias.id ? null : current,
          );
          setIsConflictCorrectionStale(false);
          const aliasesForCollisionLookup = Array.from(
            new Set(
              (visibleAliases ?? [])
                .filter((visibleAlias) => visibleAlias.id !== alias.id)
                .map((visibleAlias) => visibleAlias.alias),
            ),
          );
          const failedRequests = await refreshAliasViews(
            undefined,
            aliasesForCollisionLookup,
          );
          if (!failedRequests) return;
          toast(
            failedRequests.length === 0
              ? { title: "Alternate title removed" }
              : {
                  title: "Alternate title removed, but refresh failed",
                  description: `The removal succeeded, but the review table may still be stale. ${formatRefreshFailures(failedRequests)} Retry the refresh below.`,
                  variant: "destructive",
                },
          );
        },
        onError: async (error) => {
          const description = errorDescription(error);
          const isStaleRemoval = description.includes(
            "changed while you were reviewing it",
          );
          if (isStaleRemoval) {
            await refreshAliasViews();
          }
          toast({
            title: "Could not remove alternate title",
            description,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="pt-5 mt-2 border-t border-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display font-bold text-foreground">
            Alternate title provenance
          </h3>
          <p className="text-sm text-muted-foreground">
            Review language, source links, and aliases shared by multiple catalog
            titles.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={ownership} onValueChange={onOwnershipChange}>
            <SelectTrigger className="w-44 rounded-xl" aria-label="Alias ownership">
              <SelectValue placeholder="All ownership" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ownership</SelectItem>
              <SelectItem value="provider">Provider-owned</SelectItem>
              <SelectItem value="editorial">Editorial</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            {isError && savedAliasPreviews.length === 0
              ? "Aliases unavailable"
              : `${visibleAliasTotal} aliases`}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 whitespace-nowrap"
            onClick={() => void exportAliases()}
            disabled={isExporting}
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? "Exporting…" : "Export all CSV"}
          </Button>
        </div>
      </div>
      {linkedAliasId !== null && (
        <div role="status" className="mb-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          {removedAliasIds.has(linkedAliasId)
            ? "This alternate title was removed and is hidden until the list refresh succeeds."
            : linkedAliasLoading
            ? "Finding linked alternate title…"
            : linkedAliasError
              ? <>Could not load the linked alternate title. <button type="button" className="text-primary underline" onClick={onRetryLinkedAlias}>Retry</button></>
              : linkedAlias
                ? <>Linked alternate title: <strong>{linkedAlias.alias}</strong>{!aliases?.some((alias) => alias.id === linkedAlias.id) ? " (shown above the filtered results)" : ""}</>
                : "This alternate title no longer exists."}
        </div>
      )}
      {removedAliasPreviews.length > 0 && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-border bg-secondary/20 px-4 py-3 text-sm"
        >
          {removedAliasPreviews.length === 1 ? (
            <>
              Removed alternate title:{" "}
              <strong>{removedAliasPreviews[0].alias}</strong>. It is hidden
              until the list refresh succeeds.
            </>
          ) : (
            <>
              {removedAliasPreviews.length} alternate titles were removed. They
              are hidden until the list refresh succeeds.
            </>
          )}
        </div>
      )}
      {savedPreviewsOutsidePage.length > 0 && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          {savedPreviewsOutsidePage.length === 1 ? (
            <>
              Saved correction:{" "}
              <strong>{savedPreviewsOutsidePage[0]?.alias}</strong> is shown
              separately above the current page of filtered results.
            </>
          ) : (
            <>
              {savedPreviewsOutsidePage.length} saved corrections are shown
              separately above the current page of filtered results.
            </>
          )}{" "}
          The result count and page navigation remain based on the filtered
          list.
        </div>
      )}
      {isError && linkedAlias && (
        <div role="alert" className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          The linked title is available, but the filtered alternate titles could not load.{" "}
          <button type="button" className="text-primary underline" onClick={onRetry}>Retry results</button>
        </div>
      )}
      {isError && savedAliasPreviews.length > 0 && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
        >
          The filtered alternate-title results could not be refreshed. Your saved
          correction preview remains visible below, but its review details may be
          stale.{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={onRetry}
            disabled={isFetching}
          >
            {isFetching ? "Retrying results…" : "Retry results"}
          </button>
        </div>
      )}
      {refreshError && (
        <>
          <div
            role="alert"
            data-testid="status-alias-refresh-warning"
            className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-300"
          >
            <div>
              <p className="font-semibold">Alternate-title refresh failed</p>
              <p>
                {describeRefreshStaleness(refreshError)}{" "}
                {savedAliasPreviews.length > 0 &&
                refreshError.includes("aliases")
                  ? "Your saved correction is shown in the table below, but its review details may be out of date. "
                  : ""}
                {formatRefreshFailures(refreshError)} Retry the refresh to check
                the latest correction and collision information.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              data-testid="button-retry-alias-refresh"
              onClick={() =>
                void refreshAliasViews(
                  refreshError ?? ["aliases", "catalog"],
                )
              }
              disabled={isRefreshingAliasViews}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshingAliasViews ? "animate-spin" : ""
                }`}
              />
              Retry refresh
            </Button>
          </div>
          {(isRefreshingAliasViews || isAliasRefreshTimedOut) && (
            <p
              role="status"
              aria-live="polite"
              data-testid="status-alias-refresh-progress"
              className="sr-only"
            >
              {isRefreshingAliasViews
                ? "Refreshing alternate-title views. A newer refresh is in progress. Earlier requests cannot replace its status."
                : "Alternate-title refresh is taking longer than expected. A previous refresh is still pending. Its results are not being treated as current. If the earlier request finishes after a retry, it will not replace the newer status."}
            </p>
          )}
        </>
      )}
      {conflictAlias && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-4 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">A newer correction is already saved</p>
              <p className="mt-1">
                Your draft was not saved. Compare the current values below before
                trying again.
              </p>
              {isConflictCorrectionStale && (
                <p
                  className="mt-2 font-medium"
                  data-testid="status-conflict-correction-stale"
                >
                  The alternate-title list refresh failed or timed out. The
                  alternate title, language, and source shown here may
                  no longer match the latest saved correction.
                </p>
              )}
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Alternate title
                  </dt>
                  <dd className="font-medium">{conflictAlias.alias}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Catalog title
                  </dt>
                  <dd className="font-medium">{conflictAlias.titleName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Language
                  </dt>
                  <dd>{conflictAlias.language ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Source
                  </dt>
                  <dd>
                    {!conflictAlias.isEditorial ? (
                      (conflictAlias.providerCitations?.length ?? 0) > 0 ? (
                        <div className="flex flex-col gap-1">
                          {conflictAlias.providerCitations?.map((citation) =>
                            citation.sourceUrl ? (
                              <a
                                key={citation.provider}
                                href={citation.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-orange-800 underline dark:text-orange-200"
                              >
                                {citation.sourceName}
                              </a>
                            ) : (
                              <span key={citation.provider}>
                                {citation.sourceName}
                                <span className="ml-1 text-xs italic text-orange-700/80 dark:text-orange-300/80">
                                  No source link
                                </span>
                              </span>
                            ),
                          )}
                        </div>
                      ) : (
                        "No active provider citations"
                      )
                    ) : conflictAlias.sourceUrl ? (
                      <a
                        href={conflictAlias.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-800 underline dark:text-orange-200"
                      >
                        {conflictAlias.sourceName}
                      </a>
                    ) : (
                      conflictAlias.sourceName
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Collision status
                  </dt>
                  <dd>
                    {conflictAlias.collision
                      ? `${conflictAlias.collisionTitleCount} titles share this alias`
                      : "Unique"}
                    {isCollisionResultsStale && " · may be stale"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80">
                    Current version
                  </dt>
                  <dd>{new Date(conflictAlias.updatedAt).toLocaleString()}</dd>
                </div>
              </dl>
              {editingId === conflictAlias.id ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="grid gap-1.5 text-xs font-semibold">
                    Alternate title
                    <Input
                      value={draft.alias}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          alias: event.target.value,
                        }))
                      }
                      maxLength={300}
                      aria-label="Alternate title for current correction"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold">
                    Language
                    <Input
                      value={draft.language}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          language: event.target.value,
                        }))
                      }
                      placeholder="Unknown"
                      aria-label="Language for current correction"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold">
                    Source link
                    <Input
                      value={draft.sourceUrl}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          sourceUrl: event.target.value,
                        }))
                      }
                      type="url"
                      placeholder="https://…"
                      aria-label="Source link for current correction"
                    />
                  </label>
                  <div className="flex gap-2 sm:col-span-3">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={saveAlias}
                      disabled={updateAlias.isPending}
                    >
                      <Save className="w-3.5 h-3.5" /> Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={cancelEditing}
                      disabled={updateAlias.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4 gap-1.5"
                  onClick={startEditingConflict}
                  disabled={updateAlias.isPending}
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit current correction
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {isFetching && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Loading alternate titles for page {aliasPage}…
        </p>
      )}
      {searchPending ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {searchTerm.trim()
            ? `Preparing alternate-title results for “${searchTerm.trim()}”…`
            : "Updating alternate-title results…"}
        </p>
      ) : isLoading ? (
        <div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />
      ) : isError && !linkedAlias && savedAliasPreviews.length === 0 ? (
        <div
          ref={aliasLoadAlertRef}
          role="alert"
          tabIndex={-1}
          aria-labelledby={aliasLoadAlertTitleId}
          aria-describedby={aliasLoadAlertDescriptionId}
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5"
        >
          <p id={aliasLoadAlertTitleId} className="font-medium text-foreground">
            Could not load alternate titles.
          </p>
          <p id={aliasLoadAlertDescriptionId} className="mt-1 text-sm text-muted-foreground">
            {loadExplanation ?? "The alternate-title request failed. Try again to review these aliases."}
          </p>
          {hasAliasCursor && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 mr-2 rounded-xl"
              onClick={() => onAliasPageChange(1, null)}
            >
              Restart alternate-title review
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="mt-3 rounded-xl"
            onClick={onRetry}
            disabled={isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {isFetching ? "Retrying…" : "Retry alternate titles"}
          </Button>
        </div>
      ) : !visibleAliases?.length ? (
        <EmptyState
          icon={BookOpen}
          title="No alternate titles found"
          desc="Try another search term or run the catalog sync to import curated aliases."
        />
      ) : (
        <div className="overflow-x-auto bg-card border border-border rounded-2xl shadow-sm">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-4 py-3">Alias</th>
                <th className="px-4 py-3">Catalog title</th>
                <th className="px-4 py-3">Language</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {aliasesWithCurrentCollisionCounts?.map((alias) => (
                <tr
                  key={alias.id}
                  ref={linkedAliasId === alias.id ? linkedRowRef : undefined}
                  aria-label={
                    isSavedAliasPreviewUnrefreshed(alias.id)
                      ? `Saved correction preview: ${alias.alias}`
                      : undefined
                  }
                  className={
                    linkedAliasId === alias.id
                      ? "bg-primary/10 ring-2 ring-inset ring-primary/50"
                      : isSavedAliasPreviewUnrefreshed(alias.id)
                        ? "bg-primary/10"
                        : savedPreviewsOutsidePage.some(
                              (savedPreview) => savedPreview.id === alias.id,
                            )
                          ? "bg-primary/5"
                          : undefined
                  }
                >
                  <td className="px-4 py-3 font-medium text-foreground min-w-52">
                    {editingId === alias.id && conflictAlias?.id !== alias.id ? (
                      <Input
                        value={draft.alias}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            alias: event.target.value,
                          }))
                        }
                        maxLength={300}
                        aria-label={`Alternate title for ${alias.titleName}`}
                      />
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {alias.alias}
                        {isSavedAliasPreviewUnrefreshed(alias.id) && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                              Saved correction preview
                            </span>
                          )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {alias.titleName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {alias.titleType}
                      {alias.titleYear ? ` · ${alias.titleYear}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground min-w-36">
                    {editingId === alias.id && conflictAlias?.id !== alias.id ? (
                      <Input
                        value={draft.language}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            language: event.target.value,
                          }))
                        }
                        placeholder="Unknown"
                        aria-label={`Language for ${alias.alias}`}
                      />
                    ) : (
                      alias.language ?? "Unknown"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === alias.id && conflictAlias?.id !== alias.id ? (
                      <Input
                        value={draft.sourceUrl}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sourceUrl: event.target.value,
                          }))
                        }
                        type="url"
                        placeholder="https://…"
                        className="min-w-56"
                        aria-label={`Source link for ${alias.alias}`}
                      />
                    ) : !alias.isEditorial && (alias.providerCitations?.length ?? 0) > 0 ? (
                      <div className="flex min-w-44 flex-col gap-1">
                        {alias.providerCitations.map((citation) => (
                          citation.sourceUrl ? (
                            <a
                              key={citation.provider}
                              href={citation.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {citation.sourceName}
                            </a>
                          ) : (
                            <span
                              key={citation.provider}
                              className="text-muted-foreground"
                            >
                              {citation.sourceName}
                              <span className="ml-1 text-xs italic">
                                No source link
                              </span>
                            </span>
                          )
                        ))}
                      </div>
                    ) : alias.sourceUrl ? (
                      <a
                        href={alias.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {alias.sourceName}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">
                        {alias.sourceName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isCollisionResultsStale ? (
                      <span
                        aria-label={`Collision results may be stale: ${
                          alias.collision
                            ? `${alias.collisionTitleCount} titles`
                            : "unique"
                        }`}
                        className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                      >
                        <AlertTriangle className="w-3 h-3" />{" "}
                        {alias.collision
                          ? `${alias.collisionTitleCount} titles`
                          : "Unique"}{" "}
                        · may be stale
                      </span>
                    ) : alias.collision ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2.5 py-1 text-xs font-bold">
                        <AlertTriangle className="w-3 h-3" />{" "}
                        {alias.collisionTitleCount} titles
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-green-600 dark:text-green-400">
                        Unique
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {reviewUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          aria-label={`Copy link to ${alias.alias} for ${alias.titleName}`}
                          onClick={() => void copyAliasLink(alias)}
                        >
                          <Link2 className="w-3.5 h-3.5" /> Copy link
                        </Button>
                      )}
                      {editingId === alias.id && conflictAlias?.id !== alias.id ? (
                        <>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={saveAlias}
                            disabled={updateAlias.isPending}
                          >
                            <Save className="w-3.5 h-3.5" /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEditing}
                            disabled={updateAlias.isPending}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => startEditing(alias)}
                          disabled={deleteAlias.isPending}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive hover:text-destructive"
                        onClick={() => removeAlias(alias)}
                        disabled={
                          deleteAlias.isPending || updateAlias.isPending
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(aliasPage > 1 || nextAliasCursor != null) && (
        <nav
          aria-label="Alternate title pages"
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p role="status" className="text-sm text-muted-foreground">
            Page {aliasPage} · {visibleAliasTotal} matching aliases
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (previousAliasCursor != null) {
                  onAliasPageChange(Math.max(1, aliasPage - 1), previousAliasCursor);
                } else if (hasPendingPreviousAliasPage && pendingPreviousAliasPage) {
                  setPendingPreviousAliasPage(null);
                  onAliasPageChange(
                    Math.max(1, aliasPage - 1),
                    pendingPreviousAliasPage.cursor,
                  );
                }
              }}
              disabled={!canNavigateToPreviousAliasPage}
            >
              Previous aliases
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (nextAliasCursor != null) {
                  setPendingPreviousAliasPage({
                    page: aliasPage + 1,
                    cursor: aliasPage === 1 ? null : currentAliasCursor,
                    q: q.trim(),
                    ownership,
                  });
                  onAliasPageChange(aliasPage + 1, nextAliasCursor);
                }
              }}
              disabled={nextAliasCursor == null}
            >
              Next aliases
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

/* ─── Audit Log ─── */

function AuditLogTab() {
  const [actionFilter, setActionFilter] = useState("");
  const [adminEmailFilter, setAdminEmailFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const LIMIT = 25;

  const activeFilters: Record<string, string> = {};
  if (actionFilter) activeFilters.action = actionFilter;
  if (adminEmailFilter) activeFilters.adminEmail = adminEmailFilter;
  if (entityTypeFilter !== "all") activeFilters.entityType = entityTypeFilter;
  if (dateFrom) activeFilters.dateFrom = new Date(dateFrom).toISOString();
  if (dateTo) {
    activeFilters.dateTo = new Date(dateTo + "T23:59:59").toISOString();
  }

  const params = { limit: LIMIT, offset: page * LIMIT, ...activeFilters };
  const exportQuery = new URLSearchParams(activeFilters).toString();
  const exportUrl = `/api/admin/audit-log/export${exportQuery ? `?${exportQuery}` : ""}`;

  const { data, isLoading } = useGetAdminAuditLog(params);

  const totalPages = Math.ceil((data?.total ?? 0) / LIMIT);
  const hasExportRows = (data?.total ?? 0) > 0;

  const ACTION_COLOR: Record<string, string> = {
    approved_contribution:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    rejected_contribution:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    flagged_contribution:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    resolved_report:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    dismissed_report: "bg-secondary text-muted-foreground",
    feedback_reviewing:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    feedback_resolved:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    feedback_closed: "bg-secondary text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-display font-bold">Audit Log</h2>
        <Button
          asChild
          size="sm"
          variant="outline"
          className={`rounded-xl gap-1.5 ${hasExportRows ? "" : "pointer-events-none opacity-50"}`}
        >
          <a
            href={hasExportRows ? exportUrl : undefined}
            aria-disabled={!hasExportRows}
            tabIndex={hasExportRows ? undefined : -1}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </a>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Filter by action…"
          className="rounded-xl h-9 w-44 text-sm"
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(0);
          }}
        />
        <Input
          placeholder="Filter by admin email…"
          className="rounded-xl h-9 w-52 text-sm"
          value={adminEmailFilter}
          onChange={(e) => {
            setAdminEmailFilter(e.target.value);
            setPage(0);
          }}
        />
        <Select
          value={entityTypeFilter}
          onValueChange={(v) => {
            setEntityTypeFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-36 h-9 rounded-xl text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="contribution">Contribution</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="feedback">Feedback</SelectItem>
            <SelectItem value="content">Content</SelectItem>
          </SelectContent>
        </Select>
        <input
          type="date"
          className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(0);
          }}
          placeholder="From"
        />
        <input
          type="date"
          className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(0);
          }}
          placeholder="To"
        />
        {(actionFilter ||
          adminEmailFilter ||
          entityTypeFilter !== "all" ||
          dateFrom ||
          dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-xl text-muted-foreground h-9"
            onClick={() => {
              setActionFilter("");
              setAdminEmailFilter("");
              setEntityTypeFilter("all");
              setDateFrom("");
              setDateTo("");
              setPage(0);
            }}
          >
            Clear
          </Button>
        )}
        {data && (
          <span className="text-xs text-muted-foreground ml-auto">
            {data.total.toLocaleString()} total entries
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !data?.entries.length ? (
        <EmptyState
          icon={ClipboardList}
          title="No audit log entries"
          desc="Moderation actions will appear here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Admin
                  </th>
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Action
                  </th>
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Entity
                  </th>
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    ID
                  </th>
                  <th className="px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="bg-card hover:bg-secondary/20 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs font-mono">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-foreground text-xs max-w-[160px] truncate">
                      {entry.adminEmail ?? (
                        <span className="text-muted-foreground italic">
                          unknown
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${ACTION_COLOR[entry.action] ?? "bg-secondary text-muted-foreground"}`}
                      >
                        {entry.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs capitalize">
                      {entry.entityType ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs font-mono">
                      {entry.entityId ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px] truncate font-mono">
                      {entry.details ? JSON.stringify(entry.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl gap-1"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl gap-1"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Integrations ─── */

function IntegrationsTab({
  integrations,
  isLoading,
  reviewMalformedTimestampsUrl,
}: {
  integrations: IntegrationHealth[] | undefined;
  isLoading: boolean;
  reviewMalformedTimestampsUrl: (provider: string) => string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedCatalogRetryKeys, setSelectedCatalogRetryKeys] = useState<
    Record<number, string[]>
  >({});
  const [expandedCatalogFailures, setExpandedCatalogFailures] = useState<
    Record<number, boolean>
  >({});
  const { data: refreshes } = useListCatalogRefreshes({
    query: {
      queryKey: getListCatalogRefreshesQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.some(
          (run) => run.status === "running" || run.status === "queued",
        )
          ? 2000
          : 30_000,
    },
  });
  const startCatalog = useStartCatalogRefresh({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCatalogRefreshesQueryKey() });
        toast({ title: "Catalog refresh started" });
      },
    },
  });
  const retryCatalog = useRetryCatalogRefresh({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCatalogRefreshesQueryKey() });
        toast({ title: "Failed titles queued for retry" });
      },
      onError: (error) => {
        const errorData =
          (error as any)?.data ?? (error as any)?.response?.data;
        const responseError = errorData?.error;
        toast({
          title: "Could not retry failed titles",
          description:
            typeof responseError === "string" ? responseError : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });
  const refresh = useRefreshAdminContent();

  if (isLoading)
    return (
      <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-3xl" />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-display font-bold">Catalog Refresh</h2>
        <Button
          onClick={() => startCatalog.mutate()}
          disabled={
            startCatalog.isPending ||
            refreshes?.some((run) => run.status === "running")
          }
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${startCatalog.isPending ? "animate-spin" : ""}`}
          />
          Refresh now
        </Button>
      </div>
      {refreshes?.length ? (
        <div className="space-y-3">
          {refreshes.slice(0, 5).map((run) => {
            const defaultSelectedKeys = run.failures.map(
              (failure) => failure.itemKey,
            );
            const selectedKeys =
              selectedCatalogRetryKeys[run.id] ?? defaultSelectedKeys;
            const failuresExpanded = expandedCatalogFailures[run.id] ?? false;
            const visibleFailures = failuresExpanded
              ? run.failures
              : run.failures.slice(0, 5);
            const percent = run.totalItems
              ? Math.round((run.processedItems / run.totalItems) * 100)
              : 0;
            return (
              <div
                key={run.id}
                className="bg-card border border-border rounded-2xl p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold capitalize">
                      {run.trigger} refresh
                    </span>
                    <span className="ml-2 text-xs uppercase text-muted-foreground">
                      {run.status}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {run.processedItems}/{run.totalItems} processed ·{" "}
                  {run.succeededItems} succeeded · {run.failedItems} failed ·{" "}
                  {run.episodesUpdated} episodes
                </div>
                {run.queuedWorkerState === "protected" && (
                  <p className="mt-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                    A live worker is protecting this stale queued refresh.
                  </p>
                )}
                {run.queuedWorkerState === "abandoned" && (
                  <p className="mt-2 text-sm font-medium text-orange-700 dark:text-orange-300">
                    No live worker owns this stale queued refresh; recovery is
                    pending.
                  </p>
                )}
                {run.failures.length > 0 && (
                  <div className="mt-3">
                    <div
                      id={`catalog-refresh-failures-${run.id}`}
                      aria-label={`Failed titles in ${run.trigger} refresh`}
                      className="max-h-64 space-y-2 overflow-y-auto"
                    >
                      {visibleFailures.map((failure) => {
                        const checked = selectedKeys.includes(failure.itemKey);
                        return (
                          <label
                            key={failure.itemKey}
                            data-testid={`catalog-refresh-failure-${failure.itemKey}`}
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={retryCatalog.isPending}
                              onCheckedChange={(value) => {
                                setSelectedCatalogRetryKeys((current) => {
                                  const previous =
                                    current[run.id] ?? defaultSelectedKeys;
                                  const next = value
                                    ? Array.from(
                                        new Set([...previous, failure.itemKey]),
                                      )
                                    : previous.filter(
                                        (key) => key !== failure.itemKey,
                                      );
                                  return { ...current, [run.id]: next };
                                });
                              }}
                              aria-label={`Retry ${failure.title}`}
                            />
                            <span className="min-w-0 text-sm">
                              <span className="font-medium text-red-600 dark:text-red-400">
                                {failure.title} ({failure.provider})
                              </span>
                              <span className="block text-muted-foreground">
                                {failure.error ?? "Unknown error"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {run.failures.length > 5 && (
                      <Button
                        className="mt-2 gap-1"
                        size="sm"
                        variant="ghost"
                        data-testid={`toggle-catalog-refresh-failures-${run.id}`}
                        aria-expanded={failuresExpanded}
                        aria-controls={`catalog-refresh-failures-${run.id}`}
                        onClick={() =>
                          setExpandedCatalogFailures((current) => ({
                            ...current,
                            [run.id]: !failuresExpanded,
                          }))
                        }
                      >
                        {failuresExpanded ? (
                          <>
                            Show fewer failed titles
                            <ChevronUp className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Show all {run.failures.length} failed titles
                            <ChevronDown className="h-4 w-4" />
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={
                        retryCatalog.isPending || selectedKeys.length === 0
                      }
                      onClick={() =>
                        retryCatalog.mutate({
                          id: run.id,
                          data: { itemKeys: selectedKeys },
                        })
                      }
                    >
                      Retry selected titles ({selectedKeys.length})
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No catalog refreshes have run yet. Automatic refreshes run weekly.
        </p>
      )}
      <h2 className="text-xl font-display font-bold mt-4">
        Integration Health
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {integrations?.map((int) => (
          <div
            key={int.provider}
            className="bg-card border border-border rounded-3xl p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-display font-bold text-foreground">
                {int.provider}
              </h3>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  int.status === "healthy"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : int.status === "provider_unavailable"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                      : int.status === "degraded"
                        ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {int.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="space-y-3 text-sm">
              {int.sustainedFailureAlert && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  Sustained provider failure. Catalog data from this source may
                  be stale.
                </div>
              )}
              {int.lowAccumulatedSuccessRateAlert && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <strong className="block">
                    Persistently low accumulated success rate
                  </strong>
                  Below 50% after at least 5 tracked refreshes. A recent
                  successful refresh does not clear this warning.
                </div>
              )}
              {int.malformedRefreshTimestampCount > 0 && (
                <div
                  role="alert"
                  className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300"
                >
                  <strong className="block">
                    Malformed rating timestamps detected
                  </strong>
                  {int.malformedRefreshTimestampCount.toLocaleString()}{" "}
                  {int.malformedRefreshTimestampCount === 1
                    ? "rating has"
                    : "ratings have"}{" "}
                  an invalid refresh timestamp for {int.provider}. This data
                  quality warning does not change provider health status.
                  <div className="mt-2">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="border-orange-400 text-orange-900 dark:border-orange-700 dark:text-orange-200"
                    >
                      <Link
                        href={reviewMalformedTimestampsUrl(int.provider)}
                      >
                        Review affected ratings
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Success Rate</span>
                <span className="font-medium">
                  {Number.isInteger(int.successRatePercent)
                    ? int.successRatePercent
                    : int.successRatePercent.toFixed(1)}
                  %
                  {int.refreshAttempts != null &&
                    int.successfulRefreshes != null &&
                    ` (${int.successfulRefreshes.toLocaleString()}/${int.refreshAttempts.toLocaleString()} refreshes)`}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Mapped Titles</span>
                <span className="font-medium">
                  {int.mappedTitles.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Missing Mappings</span>
                <span
                  className={`font-medium ${int.missingMappings > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}`}
                >
                  {int.missingMappings}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">
                  Ratings with malformed refresh timestamps
                </span>
                <span
                  className={`font-medium ${int.malformedRefreshTimestampCount > 0 ? "text-orange-600 dark:text-orange-400" : ""}`}
                >
                  {int.malformedRefreshTimestampCount.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <div>
                  <span className="text-muted-foreground">Last Sync</span>
                  {int.lastSyncAtMalformed && (
                    <span
                      role="alert"
                      className="mt-1 block text-xs font-medium text-orange-700 dark:text-orange-300"
                    >
                      Stored timestamp was malformed and discarded. Investigate
                      this provider value.
                    </span>
                  )}
                </div>
                <span className="font-medium text-right">
                  {int.lastSyncAt
                    ? new Date(int.lastSyncAt).toLocaleString()
                    : int.lastSyncAtMalformed
                      ? "Unavailable"
                      : "Never"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <div>
                  <span className="text-muted-foreground">Last Success</span>
                  {int.lastSuccessAtMalformed && (
                    <span
                      role="alert"
                      className="mt-1 block text-xs font-medium text-orange-700 dark:text-orange-300"
                    >
                      Stored timestamp was malformed and discarded. Investigate
                      this provider value.
                    </span>
                  )}
                </div>
                <span className="font-medium text-right">
                  {int.lastSuccessAt
                    ? new Date(int.lastSuccessAt).toLocaleString()
                    : int.lastSuccessAtMalformed
                      ? "Unavailable"
                      : "Never"}
                </span>
              </div>
              {int.lastError && (
                <div className="py-2">
                  <span className="text-muted-foreground block mb-1">
                    Last Error
                  </span>
                  <span className="text-xs text-red-600 dark:text-red-400 font-mono bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded">
                    {int.lastError}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
