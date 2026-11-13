'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Globe2,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
} from 'lucide-react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Graticule,
  Marker,
  Sphere,
  ZoomableGroup,
} from 'react-simple-maps';
import { geoCentroid } from 'd3-geo';
import worldAtlas from 'world-atlas/countries-110m.json';
import { numericToAlpha2 } from 'i18n-iso-countries';
import type { GeoJsonObject } from 'geojson';
import {
  CompanyLocation,
  CompanySummary,
  CompanyViewResponse,
  GeographyLayer,
  PRODUCT_REGIONS,
  ProductRegion,
  TechTree,
} from '@/lib/types';
import {
  aggregateCompaniesByCountry,
  CompanyLocationGroup,
  CountryCompanyAggregate,
  getCompanyCountries,
  getCountryBubbleRadius,
  groupCompanyLocations,
} from '@/lib/geography';
import { CountryMapDrawer } from './CountryMapDrawer';
import { LoadingSpinner } from './LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface WorldExplorerProps {
  data: CompanyViewResponse | null;
  techTree: TechTree | null;
  isLoading: boolean;
  error: string | null;
  selectedCountryIso?: string;
  onSelectCountry: (
    countryIso: string,
    countryName: string,
    layer: GeographyLayer,
    companies: CompanySummary[],
  ) => void;
  onClearCountry: () => void;
  onShowCompany: (company: CompanySummary) => void;
  onShowTechnology: (technologyId: string) => void;
}

interface MapPosition {
  coordinates: [number, number];
  zoom: number;
}

const DEFAULT_POSITION: MapPosition = {
  coordinates: [0, 10],
  zoom: 1,
};
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const MAP_COLORS = ['#dbeafe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'];
const COMPANY_LOCATIONS: CompanyLocation[] = [];

function getCountryColor(count: number, maximum: number): string {
  if (count === 0 || maximum === 0) return '#e5e7eb';
  const index = Math.min(
    MAP_COLORS.length - 1,
    Math.max(0, Math.ceil((count / maximum) * MAP_COLORS.length) - 1),
  );
  return MAP_COLORS[index];
}

export function WorldExplorer({
  data,
  techTree,
  isLoading,
  error,
  selectedCountryIso,
  onSelectCountry,
  onClearCountry,
  onShowCompany,
  onShowTechnology,
}: WorldExplorerProps) {
  const [layer, setLayer] = useState<GeographyLayer>('headquarters');
  const [region, setRegion] = useState<ProductRegion>('All');
  const [position, setPosition] = useState<MapPosition>(DEFAULT_POSITION);
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [hoveredCity, setHoveredCity] = useState<CompanyLocationGroup | null>(
    null,
  );
  const [activeCountryIso, setActiveCountryIso] = useState<string | null>(
    selectedCountryIso ?? null,
  );

  useEffect(() => {
    if (selectedCountryIso) setActiveCountryIso(selectedCountryIso);
  }, [selectedCountryIso]);

  const aggregates = useMemo(
    () =>
      data?.available
        ? aggregateCompaniesByCountry(data.companies, layer, region)
        : [],
    [data, layer, region],
  );
  const aggregateByCountry = useMemo(
    () => new Map(aggregates.map((aggregate) => [aggregate.countryIso, aggregate])),
    [aggregates],
  );
  const maximumCount = Math.max(
    0,
    ...aggregates.map((aggregate) => aggregate.companies.length),
  );
  const selectedAggregate = activeCountryIso
    ? aggregateByCountry.get(activeCountryIso)
    : undefined;
  const hoveredAggregate = hoveredCountry
    ? aggregateByCountry.get(hoveredCountry)
    : undefined;
  const unlocatedCompanies = useMemo(
    () =>
      data?.available
        ? data.companies.filter(
            (company) => getCompanyCountries(company, layer).length === 0,
          )
        : [],
    [data, layer],
  );
  const locationGroups = useMemo(() => {
    if (!data?.available || layer !== 'headquarters') return [];
    const groups = groupCompanyLocations(
      data.locations ?? COMPANY_LOCATIONS,
      data.companies,
    );
    return groups.filter((group) => {
      if (!aggregateByCountry.has(group.countryIso)) return false;
      return !activeCountryIso || group.countryIso === activeCountryIso;
    });
  }, [data, layer, aggregateByCountry, activeCountryIso]);
  const verifiedCompanyCount = useMemo(
    () =>
      new Set(
        locationGroups.flatMap((group) =>
          group.companies.map((company) => company.id),
        ),
      ).size,
    [locationGroups],
  );

  const selectCountry = (
    aggregate: CountryCompanyAggregate,
    coordinates?: [number, number],
  ) => {
    setActiveCountryIso(aggregate.countryIso);
    onSelectCountry(
      aggregate.countryIso,
      aggregate.countryName,
      layer,
      aggregate.companies,
    );
    if (coordinates) {
      setPosition((current) => ({
        coordinates,
        zoom: Math.max(current.zoom, 2.4),
      }));
    }
  };

  const closeDrawer = () => {
    setActiveCountryIso(null);
    onClearCountry();
  };

  const changeLayer = (nextLayer: GeographyLayer) => {
    setLayer(nextLayer);
    setActiveCountryIso(null);
    onClearCountry();
  };

  const changeRegion = (nextRegion: ProductRegion) => {
    setRegion(nextRegion);
    setActiveCountryIso(null);
    onClearCountry();
  };

  const changeZoom = (increment: number) => {
    setPosition((current) => ({
      ...current,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom + increment)),
    }));
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <LoadingSpinner />
      </div>
    );
  }
  if (error) {
    return <StatusMessage title="Unable to load world data" body={error} />;
  }
  if (data && !data.available) {
    return <StatusMessage title="World view unavailable" body={data.reason} />;
  }

  const coveredCompanies =
    data?.available && layer === 'headquarters'
      ? data.coverage.mappedWithHeadquarters
      : data?.available
        ? data.coverage.mappedWithManufacturing
        : 0;
  const mappedCompanies = data?.available ? data.coverage.mappedCompanies : 0;

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-50">
      <div
        className={`absolute top-4 z-20 w-72 rounded-lg border border-gray-200 bg-white/95 p-4 shadow-sm transition-all ${
          selectedAggregate ? 'right-[25rem]' : 'right-4'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-gray-900">World view</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {coveredCompanies} of {mappedCompanies} mapped companies have data
              for this layer.
            </p>
          </div>
          <Badge variant="secondary">{aggregates.length} countries</Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={layer === 'headquarters' ? 'default' : 'outline'}
            onClick={() => changeLayer('headquarters')}
          >
            Headquarters
          </Button>
          <Button
            type="button"
            size="sm"
            variant={layer === 'manufacturing' ? 'default' : 'outline'}
            onClick={() => changeLayer('manufacturing')}
          >
            Manufacturing
          </Button>
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Product region
          </p>
          <div className="flex flex-wrap gap-1">
            {PRODUCT_REGIONS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={region === option ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => changeRegion(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2 text-xs text-gray-500">
          <span>Unknown / unlocated</span>
          <span className="font-medium text-gray-800">
            {unlocatedCompanies.length}
          </span>
        </div>
        {layer === 'headquarters' && (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Verified city pins</span>
            <span className="font-medium text-gray-800">
              {verifiedCompanyCount}
            </span>
          </div>
        )}
        {layer === 'manufacturing' && (
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            Manufacturing coverage is sparse and remains separate from
            headquarters.
          </p>
        )}
      </div>

      <div className="absolute left-4 top-32 z-20 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-10 rounded-none p-0"
          onClick={() => changeZoom(0.6)}
          disabled={position.zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-10 rounded-none border-y border-gray-200 p-0"
          onClick={() => changeZoom(-0.6)}
          disabled={position.zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-10 rounded-none p-0"
          onClick={() => setPosition(DEFAULT_POSITION)}
          aria-label="Reset map position"
        >
          <LocateFixed className="h-4 w-4" />
        </Button>
        <span className="border-t border-gray-200 px-1 py-1 text-center text-[10px] text-gray-500">
          {position.zoom.toFixed(1)}×
        </span>
      </div>

      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 148 }}
        className="h-full w-full"
        aria-label={`${layer} company presence map`}
      >
        <ZoomableGroup
          center={position.coordinates}
          zoom={position.zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onMoveEnd={({ coordinates, zoom }) => {
            if (!coordinates || zoom == null) return;
            setPosition({ coordinates, zoom });
          }}
        >
          <Sphere id="world-sphere" fill="#f8fafc" stroke="#cbd5e1" />
          <Graticule stroke="#e2e8f0" />
          <Geographies geography={worldAtlas as unknown as GeoJsonObject}>
            {({ geographies }) =>
              geographies.map((geography) => {
                const countryIso = numericToAlpha2(
                  String(geography.id).padStart(3, '0'),
                );
                const aggregate = countryIso
                  ? aggregateByCountry.get(countryIso)
                  : undefined;
                const count = aggregate?.companies.length ?? 0;
                const isSelected = activeCountryIso === countryIso;
                const centroid = geoCentroid(geography);
                const bubbleRadius = getCountryBubbleRadius(count, maximumCount);
                const companyLabel = count === 1 ? 'company' : 'companies';

                return (
                  <Fragment key={geography.rsmKey}>
                    <Geography
                      geography={geography}
                      fill={getCountryColor(count, maximumCount)}
                      stroke={isSelected ? '#f97316' : '#ffffff'}
                      strokeWidth={
                        (isSelected ? 2.2 : 0.6) / position.zoom
                      }
                      tabIndex={count > 0 ? 0 : -1}
                      role={count > 0 ? 'button' : undefined}
                      aria-label={
                        aggregate
                          ? `${aggregate.countryName}: ${count} ${companyLabel}`
                          : undefined
                      }
                      className={
                        count > 0
                          ? 'cursor-pointer outline-none transition-opacity hover:opacity-80'
                          : 'outline-none'
                      }
                      onMouseEnter={() => setHoveredCountry(countryIso ?? null)}
                      onMouseLeave={() => setHoveredCountry(null)}
                      onFocus={() => setHoveredCountry(countryIso ?? null)}
                      onBlur={() => setHoveredCountry(null)}
                      onClick={() => {
                        if (aggregate) selectCountry(aggregate, centroid);
                      }}
                      onKeyDown={(event) => {
                        if (
                          !aggregate ||
                          (event.key !== 'Enter' && event.key !== ' ')
                        ) {
                          return;
                        }
                        event.preventDefault();
                        selectCountry(aggregate, centroid);
                      }}
                    />
                    {aggregate && bubbleRadius > 0 && (
                      <Marker
                        coordinates={centroid}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${aggregate.countryName}: ${count} ${companyLabel}`}
                        className="cursor-pointer outline-none"
                        onMouseEnter={() =>
                          setHoveredCountry(aggregate.countryIso)
                        }
                        onMouseLeave={() => setHoveredCountry(null)}
                        onFocus={() => setHoveredCountry(aggregate.countryIso)}
                        onBlur={() => setHoveredCountry(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectCountry(aggregate, centroid);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          selectCountry(aggregate, centroid);
                        }}
                      >
                        <circle
                          r={bubbleRadius / position.zoom}
                          fill={isSelected ? '#f97316' : '#0f172a'}
                          fillOpacity={0.88}
                          stroke="#ffffff"
                          strokeWidth={2 / position.zoom}
                        />
                        <text
                          textAnchor="middle"
                          y={3 / position.zoom}
                          style={{
                            fontSize: `${11 / position.zoom}px`,
                            fontWeight: 700,
                            fill: '#ffffff',
                            pointerEvents: 'none',
                          }}
                        >
                          {count}
                        </text>
                      </Marker>
                    )}
                  </Fragment>
                );
              })
            }
          </Geographies>
          {position.zoom >= 1.8 &&
            locationGroups.map((group) => {
              const aggregate = aggregateByCountry.get(group.countryIso);
              if (!aggregate) return null;
              const count = group.companies.length;
              return (
                <Marker
                  key={group.key}
                  coordinates={group.coordinates}
                  role="button"
                  tabIndex={0}
                  aria-label={`${group.label}: ${count} verified ${
                    count === 1 ? 'company location' : 'company locations'
                  }`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setHoveredCity(group)}
                  onMouseLeave={() => setHoveredCity(null)}
                  onFocus={() => setHoveredCity(group)}
                  onBlur={() => setHoveredCity(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectCountry(aggregate, group.coordinates);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    selectCountry(aggregate, group.coordinates);
                  }}
                >
                  <circle
                    r={6 / position.zoom}
                    fill="#f97316"
                    stroke="#ffffff"
                    strokeWidth={2 / position.zoom}
                  />
                  {count > 1 && (
                    <text
                      textAnchor="middle"
                      y={2.5 / position.zoom}
                      style={{
                        fontSize: `${8 / position.zoom}px`,
                        fontWeight: 700,
                        fill: '#ffffff',
                        pointerEvents: 'none',
                      }}
                    >
                      {count}
                    </text>
                  )}
                </Marker>
              );
            })}
        </ZoomableGroup>
      </ComposableMap>

      <div className="absolute bottom-5 left-5 z-20 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm">
        <p className="mb-2 text-xs font-medium text-gray-700">Companies</p>
        <div className="flex items-center gap-1">
          {MAP_COLORS.map((color) => (
            <span
              key={color}
              className="h-3 w-8"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span>1</span>
          <span>{maximumCount || 0}</span>
        </div>
      </div>

      {hoveredAggregate && !selectedAggregate && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-700" />
            <span className="font-medium text-gray-900">
              {hoveredAggregate.countryName}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {hoveredAggregate.companies.length}{' '}
            {hoveredAggregate.companies.length === 1
              ? 'company'
              : 'companies'}
          </p>
        </div>
      )}

      {hoveredCity && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-orange-200 bg-white px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-orange-600" />
            <span className="font-medium text-gray-900">{hoveredCity.label}</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {hoveredCity.companies
              .map((company) => company.canonical_name)
              .join(', ')}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Verified from headquarters text
          </p>
        </div>
      )}

      {selectedAggregate && data?.available && (
        <div className="absolute bottom-20 left-4 right-4 top-4 z-30 md:bottom-4 md:left-auto md:w-96">
          <CountryMapDrawer
            aggregate={selectedAggregate}
            layer={layer}
            mappings={data.mappings}
            techTree={techTree}
            verifiedLocations={locationGroups}
            onClose={closeDrawer}
            onShowCompany={onShowCompany}
            onShowTechnology={onShowTechnology}
          />
        </div>
      )}
    </div>
  );
}

function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-8">
      <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}
