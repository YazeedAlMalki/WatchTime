import React from "react";
import { useGetMe, useGetAdminDashboard, getGetAdminDashboardQueryKey, useListAdminContributions, useListAdminReports, useListAdminFeedback, useListAdminIntegrations } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, Users, Database, Server, Activity, Settings, MessageSquare, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: dashboard } = useGetAdminDashboard({ query: { enabled: !!me?.isAdmin, queryKey: getGetAdminDashboardQueryKey() }});

  if (meLoading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>;
  if (!me?.isAdmin) return <Redirect to="/" />;

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 min-h-screen">
      <header className="mb-8 flex items-center gap-4">
        <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-lg">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Admin Portal</h1>
          <p className="text-muted-foreground font-medium">WatchTime Management Console</p>
        </div>
      </header>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="bg-secondary/50 p-1 rounded-xl mb-8 flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard" className="rounded-lg data-[state=active]:bg-background"><Activity className="w-4 h-4 mr-2" /> Dashboard</TabsTrigger>
          <TabsTrigger value="moderation" className="rounded-lg data-[state=active]:bg-background"><CheckCircle className="w-4 h-4 mr-2" /> Moderation</TabsTrigger>
          <TabsTrigger value="reports" className="rounded-lg data-[state=active]:bg-background"><AlertTriangle className="w-4 h-4 mr-2" /> Reports</TabsTrigger>
          <TabsTrigger value="feedback" className="rounded-lg data-[state=active]:bg-background"><MessageSquare className="w-4 h-4 mr-2" /> Feedback</TabsTrigger>
          <TabsTrigger value="integrations" className="rounded-lg data-[state=active]:bg-background"><Server className="w-4 h-4 mr-2" /> Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="outline-none">
          {dashboard ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatCard title="Total Users" value={dashboard.totalUsers} icon={Users} trend={`+${dashboard.newRegistrations7d} this week`} />
              <StatCard title="Titles in Catalog" value={dashboard.titlesInCatalog} icon={Database} />
              <StatCard title="Safety Coverage" value={`${Math.round(dashboard.safetyCoveragePercent)}%`} icon={ShieldAlert} />
              <StatCard title="Pending Contributions" value={dashboard.pendingContributions} icon={CheckCircle} color="text-yellow-600" />
              <StatCard title="Open Reports" value={dashboard.openReports} icon={AlertTriangle} color="text-red-600" />
              <StatCard title="Failed Syncs" value={dashboard.failedSyncs} icon={XCircle} color={dashboard.failedSyncs > 0 ? "text-red-600" : "text-green-600"} />
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-3xl" />
          )}
        </TabsContent>

        <TabsContent value="moderation" className="outline-none">
          <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground shadow-sm">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-display font-medium text-foreground mb-2">Moderation Queue</h3>
            <p>Approve or reject community safety contributions.</p>
            {/* The rest of the implementation would use useListAdminContributions and useUpdateAdminContribution */}
            <div className="mt-8 text-sm italic">UI implementation stubbed.</div>
          </div>
        </TabsContent>
        
        <TabsContent value="reports" className="outline-none">
          <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground shadow-sm">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-display font-medium text-foreground mb-2">Safety Reports</h3>
            <p>Review reports of incorrect safety data.</p>
            <div className="mt-8 text-sm italic">UI implementation stubbed.</div>
          </div>
        </TabsContent>

        <TabsContent value="feedback" className="outline-none">
           <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground shadow-sm">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-display font-medium text-foreground mb-2">User Feedback</h3>
            <p>Review and categorize beta feedback.</p>
            <div className="mt-8 text-sm italic">UI implementation stubbed.</div>
          </div>
        </TabsContent>

        <TabsContent value="integrations" className="outline-none">
          <IntegrationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, trend, color = "text-primary" }: any) {
  return (
    <div className="bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
        <div className={`p-2 rounded-xl bg-secondary/50 ${color}`}><Icon className="w-5 h-5" /></div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-display font-bold text-foreground">{value}</span>
        {trend && <span className="text-sm font-medium text-green-600">{trend}</span>}
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { data: integrations, isLoading } = useListAdminIntegrations();

  if (isLoading) return <div className="h-64 flex items-center justify-center animate-pulse bg-secondary/30 rounded-3xl" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {integrations?.map(int => (
        <div key={int.provider} className="bg-card border border-border rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-display font-bold text-foreground">{int.provider}</h3>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              int.status === 'healthy' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
              int.status === 'provider_unavailable' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {int.status.replace('_', ' ')}
            </span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Success Rate</span>
              <span className="font-medium text-foreground">{int.successRatePercent}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Mapped Titles</span>
              <span className="font-medium text-foreground">{int.mappedTitles.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Last Sync</span>
              <span className="font-medium text-foreground">{int.lastSyncAt ? new Date(int.lastSyncAt).toLocaleString() : 'Never'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
