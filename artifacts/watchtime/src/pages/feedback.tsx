import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChartBar, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { trackEvent } from "@/lib/analytics";

const feedbackSchema = z.object({
  category: z.enum(["bug", "feature", "general"]),
  message: z.string().min(10, "Message must be at least 10 characters").max(1000),
  page: z.string().optional(),
});

export default function FeedbackPage() {
  const createFeedback = useCreateFeedback();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof feedbackSchema>>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      category: "general",
      message: "",
      page: "",
    },
  });

  const onSubmit = (values: z.infer<typeof feedbackSchema>) => {
    createFeedback.mutate(
      { data: values },
      {
        onSuccess: () => {
          trackEvent("feedback_submitted", {
            category: values.category,
            has_page_context: Boolean(values.page),
          });
          toast({
            title: "Feedback sent",
            description: "Thank you for helping us improve WatchTime!",
          });
          form.reset();
        },
        onError: (err: any) => {
          const is429 = err?.response?.status === 429;
          toast({
            title: is429 ? "Too many requests" : "Error",
            description: is429
              ? "You've sent too much feedback recently. Please wait a while before trying again."
              : "Failed to send feedback. Please try again.",
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center min-h-screen">
      <div className="w-full max-w-lg bg-card border border-border rounded-3xl p-8 sm:p-10 shadow-lg">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-4">
            <ChartBar className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground mb-2">Send Feedback</h1>
          <p className="text-muted-foreground">We're in beta and would love to hear your thoughts.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Category</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="bug">Report a Bug</SelectItem>
                      <SelectItem value="feature">Feature Request</SelectItem>
                      <SelectItem value="general">General Feedback</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="page"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Related Page (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. /browse, /my-shows" {...field} className="bg-background" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Message</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Tell us what's on your mind..." 
                      className="resize-none min-h-[150px] bg-background" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full h-12 rounded-xl text-base font-semibold shadow-md"
              disabled={createFeedback.isPending}
            >
              {createFeedback.isPending ? "Sending..." : (
                <><Send className="mr-2 w-5 h-5" /> Send Feedback</>
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
