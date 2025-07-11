"use client";

import {
  useIncidentActions,
  type IncidentDto,
} from "@/entities/incidents/model";
import React, { useState } from "react";
import { useIncident, useIncidentAlerts } from "@/utils/hooks/useIncidents";
import { Disclosure } from "@headlessui/react";
import { IoChevronDown } from "react-icons/io5";
import { Badge, Callout } from "@tremor/react";
import { Button, DynamicImageProviderIcon, Link } from "@/components/ui";
import { IncidentChangeStatusSelect } from "features/incidents/change-incident-status";
import { getIncidentName } from "@/entities/incidents/lib/utils";
import { DateTimeField, FieldHeader } from "@/shared/ui";
import {
  SameIncidentField,
  FollowingIncidents,
} from "@/features/incidents/same-incidents-in-the-past/";
import { StatusIcon } from "@/entities/incidents/ui/statuses";
import clsx from "clsx";
import { TbSparkles } from "react-icons/tb";
import {
  CopilotTask,
  useCopilotAction,
  useCopilotContext,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { IncidentOverviewSkeleton } from "../incident-overview-skeleton";
import { AlertDto } from "@/entities/alerts/model";
import { useRouter } from "next/navigation";
import { RootCauseAnalysis } from "@/components/ui/RootCauseAnalysis";
import { IncidentChangeSeveritySelect } from "features/incidents/change-incident-severity";
import { useApi } from "@/shared/lib/hooks/useApi";
import { startCase, map } from "lodash";
import { useConfig } from "@/utils/hooks/useConfig";
import { EnrichmentEditableField } from "@/app/(keep)/incidents/[id]/enrichments/EnrichmentEditableField";
import { EnrichmentEditableForm } from "@/app/(keep)/incidents/[id]/enrichments/EnrichmentEditableForm";
import { FormattedContent } from "@/shared/ui/FormattedContent/FormattedContent";

const PROVISIONED_ENRICHMENTS = [
  "services",
  "incident_id",
  "incident_url",
  "incident_provider",
  "incident_title",
  "environments",
  "repositories",
];

interface Props {
  incident: IncidentDto;
}

function Summary({
  title,
  summary,
  collapsable,
  className,
  alerts,
  incident,
}: {
  title: string;
  summary: string;
  collapsable?: boolean;
  className?: string;
  alerts: AlertDto[];
  incident: IncidentDto;
}) {
  const [generatedSummary, setGeneratedSummary] = useState("");
  const { data: config } = useConfig();
  const { updateIncident } = useIncidentActions();
  const context = useCopilotContext();
  useCopilotReadable({
    description: "The incident alerts",
    value: alerts,
  });
  useCopilotReadable({
    description: "The incident title",
    value: incident.user_generated_name ?? incident.ai_generated_name,
  });
  useCopilotAction({
    name: "setGeneratedSummary",
    description: "Set the generated summary",
    parameters: [
      { name: "summary", type: "string", description: "The generated summary" },
    ],
    handler: async ({ summary }) => {
      await updateIncident(
        incident.id,
        {
          user_summary: summary,
        },
        true
      );
      setGeneratedSummary(summary);
    },
  });
  const task = new CopilotTask({
    instructions:
      "Generate a short concise summary of the incident based on the context of the alerts and the title of the incident. Don't repeat prompt.",
  });
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const executeTask = async () => {
    setGeneratingSummary(true);
    await task.run(context);
    setGeneratingSummary(false);
  };

  const formatedSummary = (
    <div className="prose prose-slate max-w-2xl [&>p]:!my-1 [&>ul]:!my-1 [&>ol]:!my-1">
      <FormattedContent content={summary ?? generatedSummary} format="html" />
    </div>
  );

  if (collapsable) {
    return (
      <Disclosure as="div" className={clsx("space-y-1", className)}>
        <Disclosure.Button>
          {({ open }) => (
            <h4 className="text-gray-500 text-sm inline-flex justify-between items-center gap-1">
              <span>{title}</span>
              <IoChevronDown
                className={clsx({ "rotate-180": open }, "text-slate-400")}
              />
            </h4>
          )}
        </Disclosure.Button>

        <Disclosure.Panel as="div" className="space-y-2 relative">
          {formatedSummary}
        </Disclosure.Panel>
      </Disclosure>
    );
  }

  return (
    <div>
      {formatedSummary}
      <Button
        variant="secondary"
        onClick={executeTask}
        className="mt-2.5"
        disabled={generatingSummary || !config?.OPEN_AI_API_KEY_SET}
        loading={generatingSummary}
        icon={TbSparkles}
        size="xs"
        tooltip={
          !config?.OPEN_AI_API_KEY_SET
            ? "AI is not configured"
            : "Generate AI summary"
        }
      >
        AI Summary
      </Button>
    </div>
  );
}

function MergedCallout({
  merged_into_incident_id,
  className,
}: {
  merged_into_incident_id: string;
  className?: string;
}) {
  const { data: merged_incident } = useIncident(merged_into_incident_id);

  if (!merged_incident) {
    return null;
  }

  return (
    <Callout
      // @ts-ignore
      title={
        <div>
          <p>This incident was merged into</p>
          <Link
            icon={() => (
              <StatusIcon className="!p-0" status={merged_incident.status} />
            )}
            href={`/incidents/${merged_incident?.id}`}
          >
            {getIncidentName(merged_incident)}
          </Link>
        </div>
      }
      color="purple"
      className={className}
    />
  );
}

export function IncidentOverview({ incident: initialIncidentData }: Props) {
  const router = useRouter();
  const { data: fetchedIncident, mutate } = useIncident(
    initialIncidentData.id,
    {
      fallbackData: initialIncidentData,
      revalidateOnMount: false,
    }
  );
  const incident = fetchedIncident || initialIncidentData;
  const summary = incident.user_summary || incident.generated_summary;
  // Why do we have "null" in services?
  const notNullServices = incident.services.filter(
    (service) => service !== "null"
  );
  const { assignIncident } = useIncidentActions();
  const {
    data: alerts,
    isLoading: _alertsLoading,
    error: alertsError,
  } = useIncidentAlerts(incident.id, 20, 0);
  const environments =
    incident.enrichments.environments ||
    (Array.from(
      new Set(
        alerts?.items
          .filter(
            (alert) =>
              alert.environment &&
              alert.environment !== "undefined" &&
              alert.environment !== "default"
          )
          .map((alert) => alert.environment)
      )
    ) as Array<string>);
  const repositories =
    incident.enrichments.repositories ||
    (Array.from(
      new Set(
        alerts?.items
          .filter((alert) => (alert as any).repository)
          .map((alert) => (alert as any).repository as string)
      )
    ) as Array<string>);

  const filterBy = (key: string, value: string) => {
    router.push(
      `/alerts/feed?cel=${key}%3D%3D${encodeURIComponent(`"${value}"`)}`
    );
  };

  const api = useApi();

  const handleBulkEnrichmentChange = async (
    fields: Record<string, string | string[]>
  ) => {
    try {
      const requestData = {
        enrichments: fields,
        fingerprint: incident.id,
      };
      await api.post(`/incidents/${incident.id}/enrich`, requestData);
      await mutate();
    } catch (error) {
      // Handle unexpected error
      console.error("An unexpected error occurred");
    }
  };

  const handleBulkUnEnrichment = async (fields: string[]) => {
    try {
      const requestData = {
        enrichments: fields,
        fingerprint: incident.id,
      };
      await api.post(`/incidents/${incident.id}/unenrich`, requestData);
      await mutate();
    } catch (error) {
      // Handle unexpected error
      console.error("An unexpected error occurred");
    }
  };

  const handleEnrichmentChange = async (
    fieldName: string,
    fieldValue: string | string[]
  ) => {
    await handleBulkEnrichmentChange({ [fieldName]: fieldValue });
  };

  const handleUnEnrichment = async (fieldName: string) => {
    await handleBulkUnEnrichment([fieldName]);
  };

  if (!alerts || _alertsLoading) {
    return <IncidentOverviewSkeleton />;
  }
  return (
    // Adding padding bottom to visually separate from the tabs
    <div className="flex gap-6 items-start w-full text-tremor-default">
      <div className="basis-2/3 grow">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="max-w-2xl">
            <FieldHeader>Summary</FieldHeader>
            <Summary
              title="Summary"
              summary={summary}
              alerts={alerts.items}
              incident={incident}
            />
            {/* @tb: not sure how we use this, but leaving it here for now
            {incident.user_summary && incident.generated_summary ? (
              <Summary
                title="AI version"
                summary={incident.generated_summary}
                collapsable={true}
                alerts={alerts.items}
                incident={incident}
              />
            ) : null} */}
            {incident.merged_into_incident_id && (
              <MergedCallout
                className="inline-block mt-2"
                merged_into_incident_id={incident.merged_into_incident_id}
              />
            )}
            <div className="mt-2">
              <SameIncidentField incident={incident} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldHeader>Services</FieldHeader>
                <EnrichmentEditableField
                  name="services"
                  value={notNullServices}
                  onUpdate={handleEnrichmentChange}
                  onDelete={
                    incident.enrichments?.services
                      ? handleUnEnrichment
                      : undefined
                  }
                />
              </div>

              <div>
                <FieldHeader>Environments</FieldHeader>
                <EnrichmentEditableField
                  name="environments"
                  value={environments}
                  onUpdate={handleEnrichmentChange}
                  onDelete={
                    incident.enrichments?.environments
                      ? handleUnEnrichment
                      : undefined
                  }
                />
              </div>

              <div>
                <FieldHeader>External incident</FieldHeader>

                <EnrichmentEditableForm
                  fields={{
                    incident_id: incident.enrichments?.incident_id,
                    incident_url: incident.enrichments?.incident_url,
                    incident_provider: incident.enrichments?.incident_provider,
                    incident_title: incident.enrichments?.incident_title,
                  }}
                  title="External incident"
                  onUpdate={handleBulkEnrichmentChange}
                  onDelete={handleBulkUnEnrichment}
                >
                  <>
                    {incident.enrichments?.incident_id &&
                    incident.enrichments?.incident_url ? (
                      <div className="flex flex-wrap gap-1 truncate">
                        <Badge
                          size="sm"
                          color="orange"
                          icon={
                            incident.enrichments?.incident_provider
                              ? (props: any) => (
                                  <DynamicImageProviderIcon
                                    providerType={
                                      incident.enrichments?.incident_provider
                                    }
                                    src={`/icons/${incident.enrichments?.incident_provider}-icon.png`}
                                    height="24"
                                    width="24"
                                    {...props}
                                  />
                                )
                              : undefined
                          }
                          className="cursor-pointer text-ellipsis"
                          onClick={() =>
                            window.open(
                              incident.enrichments.incident_url,
                              "_blank"
                            )
                          }
                        >
                          {incident.enrichments?.incident_title ??
                            incident.user_generated_name}
                        </Badge>
                      </div>
                    ) : (
                      "No external incidents"
                    )}
                  </>
                </EnrichmentEditableForm>
              </div>

              <div>
                <FieldHeader>Repositories</FieldHeader>

                <EnrichmentEditableField
                  name="repositories"
                  value={repositories}
                  onUpdate={handleEnrichmentChange}
                  onDelete={
                    incident.enrichments?.repositories
                      ? handleUnEnrichment
                      : undefined
                  }
                >
                  {repositories?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {repositories.map((repo: any) => {
                        const repoName = repo.split("/").pop();
                        return (
                          <Badge
                            key={repo}
                            color="orange"
                            size="sm"
                            icon={(props: any) => (
                              <DynamicImageProviderIcon
                                providerType="github"
                                src={`/icons/github-icon.png`}
                                height="24"
                                width="24"
                                {...props}
                              />
                            )}
                            className="cursor-pointer"
                            onClick={() => window.open(repo, "_blank")}
                          >
                            {repoName}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : (
                    "No environments involved"
                  )}
                </EnrichmentEditableField>
              </div>
              <div>
                <FieldHeader>Assignee</FieldHeader>
                <div className="flex flex-col gap-1">
                  {incident.assignee ? (
                    <p>{incident.assignee}</p>
                  ) : (
                    <p>No assignee yet</p>
                  )}
                  <div>
                    <span
                      className="text-sm text-gray-500 cursor-pointer hover:text-orange-500 underline"
                      onClick={() => {
                        if (
                          confirm(
                            "Are you sure you want to assign this incident to yourself?"
                          )
                        ) {
                          assignIncident(incident.id);
                        }
                      }}
                    >
                      Assign to me
                    </span>
                  </div>
                </div>
              </div>
              {incident.rule_fingerprint !== "none" &&
                !!incident.rule_fingerprint && (
                  <div>
                    <FieldHeader>Grouped by</FieldHeader>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        color="orange"
                        size="sm"
                        className="cursor-pointer overflow-ellipsis"
                        tooltip={incident.rule_fingerprint}
                      >
                        {incident.rule_fingerprint.length > 10
                          ? incident.rule_fingerprint.slice(0, 10) + "..."
                          : incident.rule_fingerprint}
                      </Badge>
                    </div>
                  </div>
                )}
              {map(incident.enrichments, (value: any, key: string) => {
                if (PROVISIONED_ENRICHMENTS.indexOf(key) > -1) return;
                return (
                  <div key={`incident-enrichment-${key}`}>
                    <FieldHeader>{startCase(key)}</FieldHeader>
                    <EnrichmentEditableField
                      name={key}
                      value={value}
                      onUpdate={handleEnrichmentChange}
                      onDelete={handleUnEnrichment}
                    />
                  </div>
                );
              })}
              <div>
                <EnrichmentEditableField
                  value={""}
                  onUpdate={handleEnrichmentChange}
                />
              </div>
            </div>
          </div>
          <div>
            <FollowingIncidents incident={incident} />
          </div>
        </div>
      </div>
      <div className="pr-10 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <FieldHeader>Status</FieldHeader>
          <IncidentChangeStatusSelect
            incidentId={incident.id}
            value={incident.status}
          />
        </div>
        <div>
          <FieldHeader>Severity</FieldHeader>
          <IncidentChangeSeveritySelect
            incidentId={incident.id}
            value={incident.severity}
          />
        </div>
        {!!incident.last_seen_time && (
          <div>
            <FieldHeader>Last seen at</FieldHeader>
            <DateTimeField date={incident.last_seen_time} />
          </div>
        )}
        {!!incident.start_time && (
          <div>
            <FieldHeader>Started at</FieldHeader>
            <DateTimeField date={incident.start_time} />
          </div>
        )}
        {incident?.enrichments && "rca_points" in incident.enrichments && (
          <RootCauseAnalysis points={incident.enrichments.rca_points} />
        )}
        <div>
          <FieldHeader>Resolve on</FieldHeader>
          <Badge
            size="sm"
            color="orange"
            className="cursor-help"
            tooltip={
              incident.resolve_on === "all_resolved"
                ? "Incident will be resolved when all its alerts are resolved"
                : "Incident will resolve only when manually set to resolved"
            }
          >
            {incident.resolve_on}
          </Badge>
        </div>
      </div>
    </div>
  );
}
