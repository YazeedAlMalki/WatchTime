import React, { useState } from "react";
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
  useListAdminContentAliases,
  useRefreshAdminContent,
  useRefreshAdminContentBatch,
  useGetAdminAuditLog,
  getGetAdminDashboardQueryKey,
  getListAdminContributionsQueryKey,
  getListAdminReportsQueryKey,
  getListAdminFeedbackQueryKey,
  getSearchAdminContentQueryKey,
  getListCatalogRefreshesQueryKey,
  type RefreshAdminContentBatch200,
  type AdminContentAlias,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: dashboard } = useGetAdminDashboard({
    query: { enabled: !!me?.isAdmin, queryKey: getGetAdminDashboardQueryKey() },
  });

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

      <Tabs defaultValue="dashboard" className="w-full">
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
        <TabsContent value="content" className="outline-none">
          <ContentTab />
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="outline-none">
          <IntegrationsTab />
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

function ModerationTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const { data: contributions, isLoading } = useListAdminContributions(
    statusFilter !== "all" ? { status: statusFilter as any } : undefined,
  );
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
      ) : !contributions?.length ? (
        <EmptyState
          icon={CheckCircle}
          title="No contributions"
          desc={`No ${statusFilter} contributions at the moment.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {contributions.map((c) => (
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
    </div>
  );
}

/* ─── Reports ─── */

function ReportsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const { data: reports, isLoading } = useListAdminReports(
    statusFilter !== "all" ? { status: statusFilter as any } : undefined,
  );
  const updateReport = useUpdateAdminReport();

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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
      ) : !reports?.length ? (
        <EmptyState
          icon={AlertTriangle}
          title="No reports"
          desc={`No ${statusFilter} reports right now.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
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
    </div>
  );
}

/* ─── Feedback ─── */

function FeedbackTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("new");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const { data: feedback, isLoading } = useListAdminFeedback({
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
  } as any);
  const updateFeedback = useUpdateAdminFeedback();

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
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
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
      ) : !feedback?.length ? (
        <EmptyState
          icon={MessageSquare}
          title="No feedback"
          desc="No matching feedback items."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {feedback.map((f) => (
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

function ContentTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [batchProvider, setBatchProvider] = useState<
    "does_the_dog_die" | "wikidata"
  >("does_the_dog_die");
  const [batchLimit, setBatchLimit] = useState("10");
  const [batchOffset, setBatchOffset] = useState("0");
  const [batchResult, setBatchResult] =
    useState<RefreshAdminContentBatch200 | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(t);
  }, [q]);

  const { data: content, isLoading } = useSearchAdminContent(
    debouncedQ ? { q: debouncedQ } : undefined,
  );
  const { data: aliases, isLoading: aliasesLoading } =
    useListAdminContentAliases(debouncedQ ? { q: debouncedQ } : undefined);
  const refresh = useRefreshAdminContent();
  const batchRefresh = useRefreshAdminContentBatch();

  const doRefresh = (
    id: number,
    name: string,
    provider: "does_the_dog_die" | "wikidata" = "does_the_dog_die",
  ) =>
    refresh.mutate(
      { id, data: { provider } },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getSearchAdminContentQueryKey() });
          if (result.ok) {
            toast({ title: `Refreshed ${name}` });
          } else {
            toast({
              title: "Refresh did not complete",
              description:
                (result as any).error ??
                "The provider data was left unchanged.",
              variant: "destructive",
            });
          }
        },
        onError: () =>
          toast({ title: "Refresh failed", variant: "destructive" }),
      },
    );

  const runBatchRefresh = () => {
    const limit = Number(batchLimit);
    const offset = Number(batchOffset);
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

    setBatchResult(null);
    batchRefresh.mutate(
      { data: { provider: batchProvider, limit, offset } },
      {
        onSuccess: (result) => {
          setBatchResult(result);
          qc.invalidateQueries({ queryKey: getSearchAdminContentQueryKey() });
          toast({
            title: "Batch refresh complete",
            description: `Processed ${result.processed} title${result.processed === 1 ? "" : "s"} starting at offset ${result.offset}.`,
          });
        },
        onError: () =>
          toast({ title: "Batch refresh failed", variant: "destructive" }),
      },
    );
  };

  const batchSummary = batchResult
    ? {
        mapped: batchResult.results.filter((result) => result.ok).length,
        missing: batchResult.results.filter(
          (result) => !result.ok && result.status === "missing",
        ).length,
        errors: batchResult.results.filter(
          (result) => !result.ok && result.status !== "missing",
        ).length,
      }
    : null;
  const nextBatchOffset = batchResult
    ? batchResult.offset + batchResult.processed
    : null;
  const isRefreshing = refresh.isPending || batchRefresh.isPending;

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
              onClick={runBatchRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`w-4 h-4 ${batchRefresh.isPending ? "animate-spin" : ""}`}
              />
              {batchRefresh.isPending ? "Refreshing…" : "Run batch refresh"}
            </Button>
          </div>
          {batchRefresh.isPending && (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
              <p className="text-xs text-muted-foreground">
                Refreshing up to {batchLimit} title
                {batchLimit === "1" ? "" : "s"} from offset {batchOffset}. Each
                title is spaced to respect provider rate limits.
              </p>
            </div>
          )}
          {batchResult && batchSummary && (
            <div className="border-t border-border/60 pt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-medium">
                  Processed {batchResult.processed} of up to {batchResult.limit}
                </span>
                <span className="text-green-600 dark:text-green-400">
                  {batchSummary.mapped} mapped
                </span>
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
              {batchResult.processed > 0 && (
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
              )}
              <div className="space-y-1.5">
                {batchResult.results.map((result) => {
                  const outcome = result.ok
                    ? {
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
                        {result.ok
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
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl"
          placeholder="Search titles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !content?.length ? (
        <EmptyState
          icon={Database}
          title="No titles found"
          desc="Try a different search term."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {content.map((item) => (
            <div
              key={item.id}
              className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
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
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl gap-1.5"
                  onClick={() => doRefresh(item.id, item.name)}
                  disabled={isRefreshing}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh DDD
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl gap-1.5"
                  onClick={() => doRefresh(item.id, item.name, "wikidata")}
                  disabled={isRefreshing}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Wikidata
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <AliasReview aliases={aliases} isLoading={aliasesLoading} />
    </div>
  );
}

function AliasReview({
  aliases,
  isLoading,
}: {
  aliases: AdminContentAlias[] | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="pt-5 mt-2 border-t border-border">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display font-bold text-foreground">
            Alternate title provenance
          </h3>
          <p className="text-sm text-muted-foreground">
            Review language, source links, and aliases shared by multiple catalog
            titles.
          </p>
        </div>
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {aliases?.length ?? 0} aliases
        </span>
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />
      ) : !aliases?.length ? (
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
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {aliases.map((alias) => (
                <tr key={alias.id}>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {alias.alias}
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
                  <td className="px-4 py-3 text-muted-foreground">
                    {alias.language ?? "Unknown"}
                  </td>
                  <td className="px-4 py-3">
                    {alias.sourceUrl ? (
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
                    {alias.collision ? (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

  const params = {
    limit: LIMIT,
    offset: page * LIMIT,
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(adminEmailFilter ? { adminEmail: adminEmailFilter } : {}),
    ...(entityTypeFilter !== "all"
      ? { entityType: entityTypeFilter as any }
      : {}),
    ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo + "T23:59:59").toISOString() } : {}),
  };

  const { data, isLoading } = useGetAdminAuditLog(params);

  const totalPages = Math.ceil((data?.total ?? 0) / LIMIT);

  const { getToken } = useAuth();

  const exportCSV = async () => {
    const token = await getToken();
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    if (adminEmailFilter) params.set("adminEmail", adminEmailFilter);
    if (entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo)
      params.set("dateTo", new Date(dateTo + "T23:59:59").toISOString());

    const qs = params.size > 0 ? `?${params}` : "";
    const res = await fetch(`/api/admin/audit-log/export${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const cd = res.headers.get("content-disposition") ?? "";
    const match = cd.match(/filename="([^"]+)"/);
    a.download =
      match?.[1] ?? `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          size="sm"
          variant="outline"
          className="rounded-xl gap-1.5"
          onClick={exportCSV}
          disabled={!data?.entries.length}
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
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

function IntegrationsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: integrations, isLoading } = useListAdminIntegrations();
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
                {run.failures.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm text-red-600 dark:text-red-400">
                      {run.failures
                        .slice(0, 5)
                        .map(
                          (failure) =>
                            `${failure.title} (${failure.provider}): ${failure.error ?? "Unknown error"}`,
                        )
                        .join(" · ")}
                    </div>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={retryCatalog.isPending}
                      onClick={() => retryCatalog.mutate({ id: run.id })}
                    >
                      Retry failed titles
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
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Success Rate</span>
                <span className="font-medium">{int.successRatePercent}%</span>
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
                <span className="text-muted-foreground">Last Sync</span>
                <span className="font-medium">
                  {int.lastSyncAt
                    ? new Date(int.lastSyncAt).toLocaleString()
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
