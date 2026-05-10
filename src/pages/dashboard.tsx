import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Users, GraduationCap, CalendarDays, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSubjectStore } from "@/stores/subject-store";
import { useTeacherStore } from "@/stores/teacher-store";
import { useClassStore } from "@/stores/class-store";
import { useTimetableStore } from "@/stores/timetable-store";

export function DashboardPage() {
  const { subjects, fetch: fetchSubjects } = useSubjectStore();
  const { teachers, fetch: fetchTeachers } = useTeacherStore();
  const { classes, fetch: fetchClasses } = useClassStore();
  const { timetables, fetch: fetchTimetables } = useTimetableStore();

  useEffect(() => {
    fetchSubjects();
    fetchTeachers();
    fetchClasses();
    fetchTimetables();
  }, [fetchSubjects, fetchTeachers, fetchClasses, fetchTimetables]);

  const stats = [
    { label: "Fächer", count: subjects.length, icon: BookOpen, to: "/subjects", color: "text-blue-500" },
    { label: "Lehrkräfte", count: teachers.length, icon: Users, to: "/teachers", color: "text-green-500" },
    { label: "Klassen", count: classes.length, icon: GraduationCap, to: "/classes", color: "text-orange-500" },
    { label: "Stundenpläne", count: timetables.length, icon: CalendarDays, to: "/timetable", color: "text-purple-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Übersicht und Schnellzugriff auf alle Bereiche
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.count}</div>
              <Link
                to={stat.to}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1"
              >
                Verwalten <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stundenplan generieren</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Konfigurieren Sie zuerst Fächer, Lehrkräfte und Klassen, bevor Sie einen Stundenplan
            generieren.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="default">
              <Link to="/timetable">
                <CalendarDays className="h-4 w-4" />
                Stundenplan generieren
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
